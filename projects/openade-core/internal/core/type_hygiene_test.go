package core

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNonTestGoFilesDoNotUseAny(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate test file")
	}
	moduleRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))
	fileset := token.NewFileSet()
	violations := []string{}

	err := filepath.WalkDir(moduleRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fileset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(node ast.Node) bool {
			ident, ok := node.(*ast.Ident)
			if ok && ident.Name == "any" {
				position := fileset.Position(ident.Pos())
				violations = append(violations, fmt.Sprintf("%s:%d", filepath.ToSlash(position.Filename), position.Line))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("scan Go files: %v", err)
	}
	if len(violations) > 0 {
		t.Fatalf("non-test Go files must not use any directly; use concrete DTOs, json.RawMessage, or core.JSONPayload at the runtime boundary: %s", strings.Join(violations, ", "))
	}
}
