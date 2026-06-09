package host

import (
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	defaultFileMaxBytes   int64 = 256 * 1024
	defaultTreeMaxDepth         = 4
	defaultTreeMaxEntries       = 1000
	defaultSearchLimit          = 100
	maxSearchFileBytes    int64 = 1024 * 1024
	maxWalkEntries              = 10000
)

var generatedSkipDirs = map[string]bool{
	"node_modules": true,
	"dist":         true,
	"build":        true,
	".next":        true,
}

type FileTreeOptions struct {
	Path             string
	MaxDepth         int
	MaxEntries       int
	IncludeHidden    bool
	IncludeGenerated bool
}

type FileTreeEntry struct {
	Path    string
	Name    string
	Type    string
	Size    *int64
	MtimeMs *int64
}

type FileTreeResult struct {
	Path      string
	Entries   []FileTreeEntry
	Truncated bool
}

type FileReadOptions struct {
	Path     string
	Encoding string
	MaxBytes int64
}

type FileReadResult struct {
	Path        string
	Encoding    string
	Size        int64
	TooLarge    bool
	Content     *string
	IsReadable  bool
	IsBinary    bool
	MediaType   *string
	PreviewKind *string
}

type FileWriteOptions struct {
	Path       string
	Encoding   string
	Content    string
	CreateDirs bool
}

type FileWriteResult struct {
	Path string
	Size int64
}

type FuzzySearchOptions struct {
	Query            string
	MatchDirs        bool
	Limit            int
	IncludeHidden    bool
	IncludeGenerated bool
}

type FuzzyTreeChild struct {
	Name     string
	IsDir    bool
	FullPath string
}

type FuzzyTreeMatch struct {
	Path     string
	Children []FuzzyTreeChild
}

type FuzzySearchResult struct {
	Results   []string
	Truncated bool
	TreeMatch *FuzzyTreeMatch
}

type SearchOptions struct {
	Query         string
	Limit         int
	CaseSensitive bool
}

type SearchMatch struct {
	Path       string
	Line       int
	Content    string
	MatchStart int
	MatchEnd   int
}

type SearchResult struct {
	Matches   []SearchMatch
	Truncated bool
}

type pathEntry struct {
	fullPath     string
	relativePath string
	isDir        bool
}

type pathTreeNode struct {
	name     string
	isDir    bool
	fullPath string
	children map[string]*pathTreeNode
}

func ListProjectFiles(root string, options FileTreeOptions) (FileTreeResult, error) {
	root, err := normalizeRoot(root)
	if err != nil {
		return FileTreeResult{}, err
	}
	start, err := resolveRootRelativePath(root, options.Path)
	if err != nil {
		return FileTreeResult{}, err
	}
	stat, err := os.Stat(start)
	if err != nil {
		return FileTreeResult{}, errors.New("path does not exist")
	}
	if !stat.IsDir() {
		return FileTreeResult{}, errors.New("path is not a directory")
	}
	maxDepth := options.MaxDepth
	if maxDepth <= 0 {
		maxDepth = defaultTreeMaxDepth
	}
	maxEntries := options.MaxEntries
	if maxEntries <= 0 {
		maxEntries = defaultTreeMaxEntries
	}

	entries := []FileTreeEntry{}
	queue := []struct {
		dir   string
		depth int
	}{{dir: start, depth: 0}}
	truncated := false
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		dirEntries, err := os.ReadDir(current.dir)
		if err != nil {
			continue
		}
		sort.Slice(dirEntries, func(i int, j int) bool {
			return dirEntries[i].Name() < dirEntries[j].Name()
		})
		for _, entry := range dirEntries {
			if shouldSkipEntry(entry.Name(), options.IncludeHidden, options.IncludeGenerated) {
				continue
			}
			if len(entries) >= maxEntries {
				truncated = true
				break
			}
			fullPath := filepath.Join(current.dir, entry.Name())
			relativePath, err := scopedRelativePath(root, fullPath)
			if err != nil {
				continue
			}
			if entry.IsDir() {
				entries = append(entries, FileTreeEntry{Path: relativePath, Name: entry.Name(), Type: "directory"})
				if current.depth < maxDepth {
					queue = append(queue, struct {
						dir   string
						depth int
					}{dir: fullPath, depth: current.depth + 1})
				}
				continue
			}
			info, err := entry.Info()
			if err != nil || !info.Mode().IsRegular() {
				continue
			}
			size := info.Size()
			mtimeMs := info.ModTime().UnixMilli()
			entries = append(entries, FileTreeEntry{Path: relativePath, Name: entry.Name(), Type: "file", Size: &size, MtimeMs: &mtimeMs})
		}
		if truncated {
			break
		}
	}
	if len(queue) > 0 {
		truncated = true
	}
	return FileTreeResult{Path: normalizeRelativePath(options.Path), Entries: entries, Truncated: truncated}, nil
}

func ReadProjectFile(root string, options FileReadOptions) (FileReadResult, error) {
	root, err := normalizeRoot(root)
	if err != nil {
		return FileReadResult{}, err
	}
	target, err := resolveRootRelativePath(root, options.Path)
	if err != nil {
		return FileReadResult{}, err
	}
	stat, err := os.Stat(target)
	if err != nil {
		return FileReadResult{}, err
	}
	if !stat.Mode().IsRegular() {
		return FileReadResult{}, errors.New("path is not a file")
	}
	encoding := options.Encoding
	if encoding != "base64" {
		encoding = "utf8"
	}
	maxBytes := options.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultFileMaxBytes
	}
	metadata := classifyFile(target, stat.Size())
	result := FileReadResult{
		Path:        normalizeRelativePath(options.Path),
		Encoding:    encoding,
		Size:        stat.Size(),
		TooLarge:    stat.Size() > maxBytes,
		IsReadable:  true,
		IsBinary:    metadata.isBinary,
		MediaType:   metadata.mediaType,
		PreviewKind: metadata.previewKind,
	}
	if result.TooLarge {
		return result, nil
	}
	data, err := os.ReadFile(target)
	if err != nil {
		result.IsReadable = false
		return result, nil
	}
	if encoding == "utf8" && metadata.isBinary {
		return result, nil
	}
	content := ""
	if encoding == "base64" {
		content = base64.StdEncoding.EncodeToString(data)
	} else {
		content = string(data)
	}
	result.Content = &content
	return result, nil
}

func WriteProjectFile(root string, options FileWriteOptions) (FileWriteResult, error) {
	root, err := normalizeRoot(root)
	if err != nil {
		return FileWriteResult{}, err
	}
	if err := validateRelativePathParam(options.Path, false); err != nil {
		return FileWriteResult{}, err
	}
	target, err := resolveRootRelativePath(root, options.Path)
	if err != nil {
		return FileWriteResult{}, err
	}
	if target == root {
		return FileWriteResult{}, errors.New("path is not a file")
	}
	if stat, err := os.Stat(target); err == nil && stat.IsDir() {
		return FileWriteResult{}, errors.New("path is not a file")
	}

	data, err := decodeFileWriteContent(options.Encoding, options.Content)
	if err != nil {
		return FileWriteResult{}, err
	}
	if options.CreateDirs {
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return FileWriteResult{}, errors.New("create parent directories failed")
		}
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return FileWriteResult{}, errors.New("write file failed")
	}
	return FileWriteResult{Path: normalizeRelativePath(options.Path), Size: int64(len(data))}, nil
}

func decodeFileWriteContent(encoding string, content string) ([]byte, error) {
	if encoding == "base64" {
		data, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			return nil, errors.New("content is not valid base64")
		}
		return data, nil
	}
	return []byte(content), nil
}

func FuzzySearchProjectFiles(root string, options FuzzySearchOptions) (FuzzySearchResult, error) {
	root, err := normalizeRoot(root)
	if err != nil {
		return FuzzySearchResult{}, err
	}
	limit := options.Limit
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	query := normalizeRelativePath(options.Query)
	entries, truncated, err := walkProjectPaths(root, walkOptions{
		includeDirs:        true,
		includeFiles:       true,
		includeHidden:      options.IncludeHidden,
		includeGenerated:   options.IncludeGenerated,
		maxReturnedEntries: maxWalkEntries,
	})
	if err != nil {
		return FuzzySearchResult{}, err
	}
	tree := buildPathTree(entries)
	var treeMatch *FuzzyTreeMatch
	if query == "" || pathTreeLookup(tree, query) != nil && pathTreeLookup(tree, query).isDir {
		treeMatch = &FuzzyTreeMatch{Path: query, Children: pathTreeChildren(tree, query)}
	}
	ranked := []struct {
		path string
		rank int
	}{}
	for _, entry := range entries {
		if options.MatchDirs != entry.isDir {
			continue
		}
		rank := rankPathMatch(entry.relativePath, query)
		if rank < 0 {
			continue
		}
		ranked = append(ranked, struct {
			path string
			rank int
		}{path: entry.relativePath, rank: rank})
	}
	sort.Slice(ranked, func(i int, j int) bool {
		if ranked[i].rank != ranked[j].rank {
			return ranked[i].rank < ranked[j].rank
		}
		return ranked[i].path < ranked[j].path
	})
	results := []string{}
	for index, entry := range ranked {
		if index >= limit {
			truncated = true
			break
		}
		results = append(results, entry.path)
	}
	return FuzzySearchResult{Results: results, Truncated: truncated, TreeMatch: treeMatch}, nil
}

func SearchProject(root string, options SearchOptions) (SearchResult, error) {
	root, err := normalizeRoot(root)
	if err != nil {
		return SearchResult{}, err
	}
	if options.Query == "" {
		return SearchResult{}, errors.New("query is required")
	}
	limit := options.Limit
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	needle := options.Query
	if !options.CaseSensitive {
		needle = strings.ToLower(needle)
	}
	files, _, err := walkProjectPaths(root, walkOptions{
		includeFiles:       true,
		includeHidden:      false,
		includeGenerated:   false,
		maxReturnedEntries: maxWalkEntries,
	})
	if err != nil {
		return SearchResult{}, err
	}
	matches := []SearchMatch{}
	truncated := false
	for _, file := range files {
		if len(matches) >= limit {
			truncated = true
			break
		}
		stat, err := os.Stat(file.fullPath)
		if err != nil || !stat.Mode().IsRegular() || stat.Size() > maxSearchFileBytes || classifyFile(file.fullPath, stat.Size()).isBinary {
			continue
		}
		data, err := os.ReadFile(file.fullPath)
		if err != nil {
			continue
		}
		lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
		for index, line := range lines {
			haystack := line
			if !options.CaseSensitive {
				haystack = strings.ToLower(haystack)
			}
			start := strings.Index(haystack, needle)
			if start < 0 {
				continue
			}
			matches = append(matches, SearchMatch{Path: file.relativePath, Line: index + 1, Content: line, MatchStart: start, MatchEnd: start + len(options.Query)})
			if len(matches) >= limit {
				truncated = true
				break
			}
		}
	}
	return SearchResult{Matches: matches, Truncated: truncated}, nil
}

type fileMetadata struct {
	isBinary    bool
	mediaType   *string
	previewKind *string
}

type walkOptions struct {
	includeDirs        bool
	includeFiles       bool
	includeHidden      bool
	includeGenerated   bool
	maxReturnedEntries int
}

func normalizeRoot(root string) (string, error) {
	if strings.TrimSpace(root) == "" {
		return "", errors.New("root path is required")
	}
	resolved, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	stat, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !stat.IsDir() {
		return "", errors.New("root path is not a directory")
	}
	return resolved, nil
}

func resolveRootRelativePath(root string, relativePath string) (string, error) {
	normalized := normalizeRelativePath(relativePath)
	target := filepath.Clean(filepath.Join(root, filepath.FromSlash(normalized)))
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return "", err
	}
	if relative == "." {
		return target, nil
	}
	if strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." || filepath.IsAbs(relative) {
		return "", errors.New("path is outside the repository")
	}
	return target, nil
}

func scopedRelativePath(root string, fullPath string) (string, error) {
	relative, err := filepath.Rel(root, fullPath)
	if err != nil {
		return "", err
	}
	if relative == "." {
		return "", nil
	}
	return filepath.ToSlash(relative), nil
}

func normalizeRelativePath(relativePath string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(relativePath, "\\", "/"))
	normalized = strings.TrimPrefix(normalized, "./")
	normalized = strings.Trim(normalized, "/")
	return normalized
}

func shouldSkipEntry(name string, includeHidden bool, includeGenerated bool) bool {
	if name == ".git" {
		return true
	}
	if !includeHidden && strings.HasPrefix(name, ".") {
		return true
	}
	return !includeGenerated && generatedSkipDirs[name]
}

func walkProjectPaths(root string, options walkOptions) ([]pathEntry, bool, error) {
	entries := []pathEntry{}
	truncated := false
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if path == root {
			return nil
		}
		if shouldSkipEntry(entry.Name(), options.includeHidden, options.includeGenerated) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		relativePath, err := scopedRelativePath(root, path)
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if options.includeDirs {
				entries = append(entries, pathEntry{fullPath: path, relativePath: relativePath, isDir: true})
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || !options.includeFiles {
			return nil
		}
		entries = append(entries, pathEntry{fullPath: path, relativePath: relativePath, isDir: false})
		if options.maxReturnedEntries > 0 && len(entries) >= options.maxReturnedEntries {
			truncated = true
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil && !errors.Is(err, filepath.SkipAll) {
		return nil, false, err
	}
	return entries, truncated, nil
}

func classifyFile(path string, size int64) fileMetadata {
	mediaType := mime.TypeByExtension(filepath.Ext(path))
	var mediaTypePtr *string
	if mediaType != "" {
		mediaTypePtr = &mediaType
	}
	var previewKind *string
	if strings.HasPrefix(mediaType, "image/") {
		kind := "image"
		previewKind = &kind
	}
	isBinary := isBinaryPath(path)
	if !isBinary && size > 0 {
		file, err := os.Open(path)
		if err == nil {
			defer file.Close()
			sample := make([]byte, 8192)
			bytesRead, readErr := file.Read(sample)
			if readErr == nil || bytesRead > 0 {
				isBinary = hasNULByte(sample[:bytesRead])
			}
		}
	}
	return fileMetadata{isBinary: isBinary, mediaType: mediaTypePtr, previewKind: previewKind}
}

func hasNULByte(values []byte) bool {
	for _, value := range values {
		if value == 0 {
			return true
		}
	}
	return false
}

func buildPathTree(entries []pathEntry) *pathTreeNode {
	root := &pathTreeNode{name: "", isDir: true, fullPath: "", children: map[string]*pathTreeNode{}}
	for _, entry := range entries {
		parts := strings.Split(entry.relativePath, "/")
		current := root
		pathSoFar := ""
		for index, part := range parts {
			if part == "" {
				continue
			}
			if pathSoFar == "" {
				pathSoFar = part
			} else {
				pathSoFar += "/" + part
			}
			child := current.children[part]
			isLast := index == len(parts)-1
			if child == nil {
				child = &pathTreeNode{name: part, isDir: !isLast || entry.isDir, fullPath: pathSoFar, children: map[string]*pathTreeNode{}}
				current.children[part] = child
			}
			if isLast && entry.isDir {
				child.isDir = true
			}
			current = child
		}
	}
	return root
}

func pathTreeLookup(root *pathTreeNode, treePath string) *pathTreeNode {
	if treePath == "" {
		return root
	}
	current := root
	for _, part := range strings.Split(treePath, "/") {
		if part == "" {
			continue
		}
		current = current.children[part]
		if current == nil {
			return nil
		}
	}
	return current
}

func pathTreeChildren(root *pathTreeNode, treePath string) []FuzzyTreeChild {
	node := pathTreeLookup(root, treePath)
	if node == nil || !node.isDir {
		return []FuzzyTreeChild{}
	}
	children := make([]FuzzyTreeChild, 0, len(node.children))
	for _, child := range node.children {
		children = append(children, FuzzyTreeChild{Name: child.name, IsDir: child.isDir, FullPath: child.fullPath})
	}
	sort.Slice(children, func(i int, j int) bool {
		if children[i].IsDir != children[j].IsDir {
			return children[i].IsDir
		}
		return children[i].Name < children[j].Name
	})
	return children
}

func rankPathMatch(pathname string, query string) int {
	if query == "" {
		return 0
	}
	lowerPath := strings.ToLower(pathname)
	lowerQuery := strings.ToLower(query)
	if index := strings.Index(lowerPath, lowerQuery); index >= 0 {
		return index
	}
	queryIndex := 0
	for _, char := range lowerPath {
		if queryIndex < len(lowerQuery) && byte(char) == lowerQuery[queryIndex] {
			queryIndex++
		}
		if queryIndex == len(lowerQuery) {
			return len(lowerPath)
		}
	}
	return -1
}

func validateRelativePathParam(pathValue string, allowEmpty bool) error {
	if pathValue == "" && allowEmpty {
		return nil
	}
	if pathValue == "" {
		return errors.New("path is required")
	}
	normalized := normalizeRelativePath(pathValue)
	if normalized == "" && !allowEmpty {
		return errors.New("path is required")
	}
	if strings.HasPrefix(strings.ReplaceAll(pathValue, "\\", "/"), "/") {
		return errors.New("path is invalid")
	}
	for _, segment := range strings.Split(normalized, "/") {
		if segment == ".." {
			return errors.New("path is invalid")
		}
	}
	return nil
}

func ValidateRelativePath(pathValue string, allowEmpty bool) error {
	return validateRelativePathParam(pathValue, allowEmpty)
}

func UnsupportedTaskScopedHostRead(taskID string) error {
	if taskID == "" {
		return nil
	}
	return fmt.Errorf("task-scoped host reads are not supported by OpenADE Core yet")
}
