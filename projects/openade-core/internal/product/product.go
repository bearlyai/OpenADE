package product

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/openade/openade/projects/openade-core/internal/core"
	"github.com/openade/openade/projects/openade-core/internal/host"
	"github.com/openade/openade/projects/openade-core/internal/storage"
)

type Options struct {
	Version          string
	HostName         string
	BlobDir          string
	WorktreeBaseDir  string
	ProcessOutputDir string
	AgentExecutor    AgentExecutor
}

type Service struct {
	runtime             *core.Runtime
	store               *storage.Store
	options             Options
	mu                  sync.Mutex
	idempotentMutations map[string]*idempotentMutationEntry
	processMu           sync.Mutex
	processes           map[string]*projectProcessState
	terminalMu          sync.Mutex
	terminals           map[string]*taskTerminalState
	agentMu             sync.Mutex
	agentExecutions     map[string]*agentExecutionState
	cronMu              sync.Mutex
	runningCrons        map[string]bool
	queueDrainMu        sync.Mutex
	pairingMu           sync.Mutex
	pairing             *pairingSession
}

type idempotentMutationEntry struct {
	result     core.JSONPayload
	runtimeErr *core.RuntimeError
	expiresAt  time.Time
	done       chan struct{}
}

const idempotentMutationRetention = 10 * time.Minute
const headlessRuntimeDeviceID = "headless-runtime"

type mutationOKDTO struct {
	OK bool `json:"ok"`
}

type snapshotDTO struct {
	Server         snapshotServerDTO `json:"server"`
	Repos          []projectDTO      `json:"repos"`
	WorkingTaskIDs []string          `json:"workingTaskIds"`
}

type snapshotServerDTO struct {
	Version  string        `json:"version"`
	HostName string        `json:"hostName"`
	Theme    snapshotTheme `json:"theme"`
}

type snapshotTheme struct {
	Setting   string `json:"setting"`
	ClassName string `json:"className"`
	Label     string `json:"label,omitempty"`
}

type projectDTO struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	Path     string           `json:"path"`
	Archived bool             `json:"archived,omitempty"`
	Tasks    []taskPreviewDTO `json:"tasks"`
}

type projectFileTreeEntryDTO struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Size    *int64 `json:"size,omitempty"`
	MtimeMs *int64 `json:"mtimeMs,omitempty"`
}

type projectFilesTreeDTO struct {
	RepoID    string                    `json:"repoId"`
	TaskID    string                    `json:"taskId,omitempty"`
	Path      string                    `json:"path"`
	Entries   []projectFileTreeEntryDTO `json:"entries"`
	Truncated bool                      `json:"truncated"`
}

type projectFileReadDTO struct {
	RepoID      string  `json:"repoId"`
	TaskID      string  `json:"taskId,omitempty"`
	Path        string  `json:"path"`
	Encoding    string  `json:"encoding"`
	Size        int64   `json:"size"`
	TooLarge    bool    `json:"tooLarge"`
	Content     *string `json:"content"`
	IsReadable  bool    `json:"isReadable,omitempty"`
	IsBinary    bool    `json:"isBinary,omitempty"`
	MediaType   *string `json:"mediaType,omitempty"`
	PreviewKind *string `json:"previewKind,omitempty"`
}

type projectFileWriteDTO struct {
	RepoID string `json:"repoId"`
	TaskID string `json:"taskId,omitempty"`
	Path   string `json:"path"`
	Size   int64  `json:"size"`
}

type projectFuzzyTreeChildDTO struct {
	Name     string `json:"name"`
	IsDir    bool   `json:"isDir"`
	FullPath string `json:"fullPath"`
}

type projectFuzzyTreeMatchDTO struct {
	Path     string                     `json:"path"`
	Children []projectFuzzyTreeChildDTO `json:"children"`
}

type projectFuzzySearchDTO struct {
	RepoID    string                    `json:"repoId"`
	TaskID    string                    `json:"taskId,omitempty"`
	Results   []string                  `json:"results"`
	Truncated bool                      `json:"truncated"`
	Source    string                    `json:"source"`
	TreeMatch *projectFuzzyTreeMatchDTO `json:"treeMatch,omitempty"`
}

type projectSearchMatchDTO struct {
	Path       string `json:"path"`
	Line       int    `json:"line"`
	Content    string `json:"content"`
	MatchStart int    `json:"matchStart"`
	MatchEnd   int    `json:"matchEnd"`
}

type projectSearchDTO struct {
	RepoID    string                  `json:"repoId"`
	TaskID    string                  `json:"taskId,omitempty"`
	Matches   []projectSearchMatchDTO `json:"matches"`
	Truncated bool                    `json:"truncated"`
}

type projectGitInfoDTO struct {
	RepoID       string `json:"repoId"`
	IsGitRepo    bool   `json:"isGitRepo"`
	RepoRoot     string `json:"repoRoot,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
	MainBranch   string `json:"mainBranch,omitempty"`
	HasGhCLI     bool   `json:"hasGhCli,omitempty"`
	Error        string `json:"error,omitempty"`
}

type projectGitBranchDTO struct {
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault"`
	IsRemote  bool   `json:"isRemote"`
}

type projectGitBranchesDTO struct {
	RepoID        string                `json:"repoId"`
	Branches      []projectGitBranchDTO `json:"branches"`
	DefaultBranch string                `json:"defaultBranch"`
}

type gitChangedFileDTO struct {
	Path    string `json:"path"`
	Status  string `json:"status"`
	OldPath string `json:"oldPath,omitempty"`
	Binary  bool   `json:"binary,omitempty"`
}

type gitChangeStatsDTO struct {
	FilesChanged int `json:"filesChanged"`
	Insertions   int `json:"insertions"`
	Deletions    int `json:"deletions"`
}

type gitPatchStatsDTO struct {
	Insertions   int `json:"insertions"`
	Deletions    int `json:"deletions"`
	ChangedLines int `json:"changedLines"`
	HunkCount    int `json:"hunkCount"`
}

type gitChangeGroupDTO struct {
	Files []gitChangedFileDTO `json:"files"`
	Stats gitChangeStatsDTO   `json:"stats"`
}

type projectGitSummaryDTO struct {
	RepoID     string              `json:"repoId"`
	Branch     *string             `json:"branch"`
	HeadCommit string              `json:"headCommit"`
	Ahead      *int                `json:"ahead"`
	HasChanges bool                `json:"hasChanges"`
	Staged     gitChangeGroupDTO   `json:"staged"`
	Unstaged   gitChangeGroupDTO   `json:"unstaged"`
	Untracked  []gitChangedFileDTO `json:"untracked"`
}

type taskGitSummaryDTO struct {
	RepoID     string              `json:"repoId"`
	TaskID     string              `json:"taskId"`
	Branch     *string             `json:"branch"`
	HeadCommit string              `json:"headCommit"`
	Ahead      *int                `json:"ahead"`
	HasChanges bool                `json:"hasChanges"`
	Staged     gitChangeGroupDTO   `json:"staged"`
	Unstaged   gitChangeGroupDTO   `json:"unstaged"`
	Untracked  []gitChangedFileDTO `json:"untracked"`
}

type taskGitBranchScopeDTO struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	Ref       string `json:"ref"`
	IsDefault bool   `json:"isDefault"`
	IsRemote  bool   `json:"isRemote"`
}

func (taskGitBranchScopeDTO) taskGitScopeDTO() {}

type taskGitWorktreeScopeDTO struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	WorktreeID string `json:"worktreeId"`
	Branch     string `json:"branch"`
	Head       string `json:"head"`
	Label      string `json:"label"`
}

func (taskGitWorktreeScopeDTO) taskGitScopeDTO() {}

type taskGitScopeDTO interface {
	taskGitScopeDTO()
}

type taskGitScopesDTO struct {
	RepoID        string            `json:"repoId"`
	TaskID        string            `json:"taskId"`
	DefaultBranch string            `json:"defaultBranch"`
	Scopes        []taskGitScopeDTO `json:"scopes"`
}

type taskChangesDTO struct {
	RepoID      string              `json:"repoId"`
	TaskID      string              `json:"taskId"`
	Files       []gitChangedFileDTO `json:"files"`
	FromTreeish string              `json:"fromTreeish"`
	ToTreeish   string              `json:"toTreeish"`
}

type taskDiffDTO struct {
	RepoID      string           `json:"repoId"`
	TaskID      string           `json:"taskId"`
	FilePath    string           `json:"filePath"`
	OldPath     string           `json:"oldPath,omitempty"`
	FromTreeish string           `json:"fromTreeish"`
	ToTreeish   string           `json:"toTreeish"`
	Patch       string           `json:"patch"`
	Truncated   bool             `json:"truncated"`
	Heavy       bool             `json:"heavy"`
	Stats       gitPatchStatsDTO `json:"stats"`
}

type taskFilePairDTO struct {
	RepoID      string `json:"repoId"`
	TaskID      string `json:"taskId"`
	FilePath    string `json:"filePath"`
	OldPath     string `json:"oldPath,omitempty"`
	FromTreeish string `json:"fromTreeish"`
	ToTreeish   string `json:"toTreeish"`
	Before      string `json:"before"`
	After       string `json:"after"`
	TooLarge    bool   `json:"tooLarge,omitempty"`
}

type taskGitLogEntryDTO struct {
	SHA          string `json:"sha"`
	ShortSHA     string `json:"shortSha"`
	Message      string `json:"message"`
	Author       string `json:"author"`
	Date         string `json:"date"`
	RelativeDate string `json:"relativeDate"`
	ParentCount  int    `json:"parentCount"`
}

type taskGitLogDTO struct {
	RepoID  string               `json:"repoId"`
	TaskID  string               `json:"taskId"`
	Commits []taskGitLogEntryDTO `json:"commits"`
	HasMore bool                 `json:"hasMore"`
}

type taskGitCommitFilesDTO struct {
	RepoID string              `json:"repoId"`
	TaskID string              `json:"taskId"`
	Commit string              `json:"commit"`
	Files  []gitChangedFileDTO `json:"files"`
}

type taskGitFileAtTreeishDTO struct {
	RepoID   string `json:"repoId"`
	TaskID   string `json:"taskId"`
	Treeish  string `json:"treeish"`
	FilePath string `json:"filePath"`
	Content  string `json:"content"`
	Exists   bool   `json:"exists"`
	TooLarge bool   `json:"tooLarge,omitempty"`
}

type taskGitCommitFilePatchDTO struct {
	RepoID    string           `json:"repoId"`
	TaskID    string           `json:"taskId"`
	Commit    string           `json:"commit"`
	FilePath  string           `json:"filePath"`
	OldPath   string           `json:"oldPath,omitempty"`
	Patch     string           `json:"patch"`
	Truncated bool             `json:"truncated"`
	Heavy     bool             `json:"heavy"`
	Stats     gitPatchStatsDTO `json:"stats"`
}

type taskGitCommitDTO struct {
	RepoID    string `json:"repoId"`
	TaskID    string `json:"taskId"`
	Committed bool   `json:"committed"`
	Status    string `json:"status"`
	SHA       string `json:"sha,omitempty"`
	Error     string `json:"error,omitempty"`
}

type procsProcessDefDTO struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
	WorkDir string `json:"workDir,omitempty"`
	URL     string `json:"url,omitempty"`
	Type    string `json:"type"`
}

type procsCronDefDTO struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Schedule           string   `json:"schedule"`
	Type               string   `json:"type"`
	Prompt             string   `json:"prompt"`
	AppendSystemPrompt string   `json:"appendSystemPrompt,omitempty"`
	Images             []string `json:"images,omitempty"`
	Isolation          string   `json:"isolation,omitempty"`
	Harness            string   `json:"harness,omitempty"`
	InTaskID           string   `json:"inTaskId,omitempty"`
	ReuseTask          bool     `json:"reuseTask"`
}

type procsConfigDTO struct {
	RelativePath string               `json:"relativePath"`
	Processes    []procsProcessDefDTO `json:"processes"`
	Crons        []procsCronDefDTO    `json:"crons"`
}

type procsConfigErrorDTO struct {
	RelativePath string `json:"relativePath"`
	Error        string `json:"error"`
	Line         int    `json:"line,omitempty"`
}

type projectProcessDefinitionDTO struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Command    string `json:"command"`
	WorkDir    string `json:"workDir,omitempty"`
	URL        string `json:"url,omitempty"`
	Type       string `json:"type"`
	ConfigPath string `json:"configPath"`
	Cwd        string `json:"cwd"`
}

type projectProcessInstanceDTO struct {
	ProcessID    string `json:"processId,omitempty"`
	DefinitionID string `json:"definitionId,omitempty"`
	RepoID       string `json:"repoId,omitempty"`
	TaskID       string `json:"taskId,omitempty"`
	Cwd          string `json:"cwd,omitempty"`
	Completed    bool   `json:"completed"`
	ExitCode     *int   `json:"exitCode,omitempty"`
	Signal       string `json:"signal,omitempty"`
	Error        string `json:"error,omitempty"`
	PID          *int   `json:"pid,omitempty"`
}

type projectProcessListDTO struct {
	RepoID       string                        `json:"repoId"`
	TaskID       string                        `json:"taskId,omitempty"`
	SearchRoot   string                        `json:"searchRoot"`
	RepoRoot     string                        `json:"repoRoot"`
	IsWorktree   bool                          `json:"isWorktree"`
	WorktreeRoot string                        `json:"worktreeRoot,omitempty"`
	Configs      []procsConfigDTO              `json:"configs"`
	Processes    []projectProcessDefinitionDTO `json:"processes"`
	Errors       []procsConfigErrorDTO         `json:"errors"`
	Instances    []projectProcessInstanceDTO   `json:"instances"`
}

type taskPreviewDTO struct {
	ID           string           `json:"id"`
	Slug         string           `json:"slug"`
	Title        string           `json:"title"`
	Closed       bool             `json:"closed,omitempty"`
	CreatedAt    string           `json:"createdAt"`
	LastEvent    *json.RawMessage `json:"lastEvent,omitempty"`
	Usage        *json.RawMessage `json:"usage,omitempty"`
	LastViewedAt string           `json:"lastViewedAt,omitempty"`
	LastEventAt  string           `json:"lastEventAt,omitempty"`
}

type taskDTO struct {
	ID                   string                 `json:"id"`
	RepoID               string                 `json:"repoId"`
	Slug                 string                 `json:"slug"`
	Title                string                 `json:"title"`
	Description          string                 `json:"description"`
	IsolationStrategy    *json.RawMessage       `json:"isolationStrategy,omitempty"`
	EnabledMCPServerIDs  []string               `json:"enabledMcpServerIds,omitempty"`
	SessionIDs           map[string]string      `json:"sessionIds,omitempty"`
	CancelledPlanEventID string                 `json:"cancelledPlanEventId,omitempty"`
	DeviceEnvironments   []deviceEnvironmentDTO `json:"deviceEnvironments"`
	CreatedBy            *userDTO               `json:"createdBy,omitempty"`
	CreatedAt            string                 `json:"createdAt,omitempty"`
	UpdatedAt            string                 `json:"updatedAt,omitempty"`
	LastViewedAt         string                 `json:"lastViewedAt,omitempty"`
	LastEventAt          string                 `json:"lastEventAt,omitempty"`
	Closed               bool                   `json:"closed,omitempty"`
	Events               []taskEventDTO         `json:"events"`
	Comments             []commentDTO           `json:"comments"`
	QueuedTurns          []queuedTurnDTO        `json:"queuedTurns,omitempty"`
}

type deviceEnvironmentDTO struct {
	ID              string `json:"id"`
	DeviceID        string `json:"deviceId"`
	WorktreeDir     string `json:"worktreeDir,omitempty"`
	SetupComplete   bool   `json:"setupComplete"`
	MergeBaseCommit string `json:"mergeBaseCommit,omitempty"`
	CreatedAt       string `json:"createdAt"`
	LastUsedAt      string `json:"lastUsedAt"`
}

type taskEnvironmentSetupEventDTO struct {
	TaskID      string `json:"taskId,omitempty"`
	EventID     string `json:"eventId,omitempty"`
	WorktreeID  string `json:"worktreeId"`
	DeviceID    string `json:"deviceId"`
	WorkingDir  string `json:"workingDir"`
	SetupOutput string `json:"setupOutput,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
}

type taskEnvironmentPrepareResultDTO struct {
	RepoID            string                        `json:"repoId"`
	TaskID            string                        `json:"taskId"`
	DeviceEnvironment deviceEnvironmentDTO          `json:"deviceEnvironment"`
	SetupEvent        *taskEnvironmentSetupEventDTO `json:"setupEvent,omitempty"`
	Cwd               string                        `json:"cwd"`
	RootPath          string                        `json:"rootPath"`
}

type taskEventDTO struct {
	raw      *json.RawMessage
	fallback taskEventFallbackDTO
}

type taskEventFallbackDTO struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	CreatedAt   string `json:"createdAt"`
	Status      string `json:"status,omitempty"`
	SourceType  string `json:"sourceType,omitempty"`
	SourceLabel string `json:"sourceLabel,omitempty"`
}

func (event taskEventDTO) MarshalJSON() ([]byte, error) {
	if event.raw != nil {
		return event.raw.MarshalJSON()
	}
	return json.Marshal(event.fallback)
}

type commentDTO struct {
	ID           string           `json:"id"`
	TaskID       string           `json:"taskId"`
	Body         string           `json:"body"`
	Content      string           `json:"content"`
	Anchor       *json.RawMessage `json:"anchor,omitempty"`
	Source       *json.RawMessage `json:"source,omitempty"`
	SelectedText *selectedTextDTO `json:"selectedText,omitempty"`
	Author       *userDTO         `json:"author,omitempty"`
	CreatedAt    string           `json:"createdAt"`
	UpdatedAt    string           `json:"updatedAt"`
}

type queuedTurnDTO struct {
	ID                  string           `json:"id"`
	ClientRequestID     string           `json:"clientRequestId,omitempty"`
	Type                string           `json:"type"`
	Input               string           `json:"input"`
	Status              string           `json:"status"`
	CreatedAt           string           `json:"createdAt"`
	UpdatedAt           string           `json:"updatedAt"`
	EventID             string           `json:"eventId,omitempty"`
	AppendSystemPrompt  string           `json:"appendSystemPrompt,omitempty"`
	EnabledMCPServerIDs []string         `json:"enabledMcpServerIds,omitempty"`
	HarnessID           string           `json:"harnessId,omitempty"`
	ModelID             string           `json:"modelId,omitempty"`
	Label               string           `json:"label,omitempty"`
	IncludeComments     *bool            `json:"includeComments,omitempty"`
	Images              *json.RawMessage `json:"images,omitempty"`
	Thinking            string           `json:"thinking,omitempty"`
	FastMode            *bool            `json:"fastMode,omitempty"`
}

type queuedTurnPayloadDTO struct {
	ClientRequestID     string           `json:"clientRequestId"`
	EventID             string           `json:"eventId"`
	AppendSystemPrompt  string           `json:"appendSystemPrompt"`
	EnabledMCPServerIDs []string         `json:"enabledMcpServerIds"`
	HarnessID           string           `json:"harnessId"`
	ModelID             string           `json:"modelId"`
	Label               string           `json:"label"`
	IncludeComments     *bool            `json:"includeComments"`
	Images              *json.RawMessage `json:"images"`
	Thinking            string           `json:"thinking"`
	FastMode            *bool            `json:"fastMode"`
}

type taskResourceImageDTO struct {
	ID  string `json:"id"`
	Ext string `json:"ext"`
}

type taskImageReferenceDTO struct {
	ID        string `json:"id"`
	Ext       string `json:"ext"`
	MediaType string `json:"mediaType,omitempty"`
}

type taskImageReadDTO struct {
	RepoID    string  `json:"repoId"`
	TaskID    string  `json:"taskId"`
	ImageID   string  `json:"imageId"`
	Ext       string  `json:"ext"`
	MediaType string  `json:"mediaType,omitempty"`
	Data      *string `json:"data"`
}

type taskImageStagedReadDTO struct {
	ImageID   string  `json:"imageId"`
	Ext       string  `json:"ext"`
	MediaType string  `json:"mediaType,omitempty"`
	Data      *string `json:"data"`
}

type taskImageWriteDTO struct {
	ImageID   string `json:"imageId"`
	Ext       string `json:"ext"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
}

type taskImageImportLegacyIssueDTO struct {
	ImageID string `json:"imageId"`
	Ext     string `json:"ext"`
	Code    string `json:"code"`
}

type taskImagesImportLegacyDTO struct {
	ScannedTasks          int                             `json:"scannedTasks"`
	ReferencedImages      int                             `json:"referencedImages"`
	ImportedImages        int                             `json:"importedImages"`
	AlreadyImportedImages int                             `json:"alreadyImportedImages"`
	MissingImages         []taskImageImportLegacyIssueDTO `json:"missingImages"`
	ConflictedImages      []taskImageImportLegacyIssueDTO `json:"conflictedImages"`
	FailedImages          []taskImageImportLegacyIssueDTO `json:"failedImages"`
}

type taskImagesGCStagedDTO struct {
	ScannedImages    int                             `json:"scannedImages"`
	ScannedTasks     int                             `json:"scannedTasks"`
	ReferencedImages int                             `json:"referencedImages"`
	EligibleImages   int                             `json:"eligibleImages"`
	DeletedImages    int                             `json:"deletedImages"`
	RetainedImages   int                             `json:"retainedImages"`
	OlderThanMs      int64                           `json:"olderThanMs"`
	DryRun           bool                            `json:"dryRun"`
	FailedImages     []taskImageImportLegacyIssueDTO `json:"failedImages"`
}

type snapshotPatchFileDTO struct {
	ID           string `json:"id"`
	Path         string `json:"path"`
	OldPath      string `json:"oldPath,omitempty"`
	Status       string `json:"status"`
	Binary       bool   `json:"binary"`
	Insertions   int    `json:"insertions"`
	Deletions    int    `json:"deletions"`
	ChangedLines int    `json:"changedLines"`
	HunkCount    int    `json:"hunkCount"`
	PatchStart   int    `json:"patchStart"`
	PatchEnd     int    `json:"patchEnd"`
}

type snapshotPatchIndexDTO struct {
	Version   int                    `json:"version"`
	PatchSize int                    `json:"patchSize"`
	Files     []snapshotPatchFileDTO `json:"files"`
}

type taskSnapshotPatchReadDTO struct {
	RepoID      string  `json:"repoId"`
	TaskID      string  `json:"taskId"`
	EventID     string  `json:"eventId"`
	PatchFileID string  `json:"patchFileId,omitempty"`
	Patch       *string `json:"patch"`
}

type taskSnapshotIndexReadDTO struct {
	RepoID      string                 `json:"repoId"`
	TaskID      string                 `json:"taskId"`
	EventID     string                 `json:"eventId"`
	PatchFileID string                 `json:"patchFileId,omitempty"`
	Index       *snapshotPatchIndexDTO `json:"index"`
}

type taskSnapshotPatchSliceReadDTO struct {
	RepoID      string  `json:"repoId"`
	TaskID      string  `json:"taskId"`
	EventID     string  `json:"eventId"`
	PatchFileID string  `json:"patchFileId,omitempty"`
	Patch       *string `json:"patch"`
}

type snapshotPatchImportLegacyIssueDTO struct {
	PatchFileID string `json:"patchFileId"`
	Code        string `json:"code"`
}

type snapshotPatchesImportLegacyDTO struct {
	ScannedTasks           int                                 `json:"scannedTasks"`
	ReferencedPatches      int                                 `json:"referencedPatches"`
	ImportedPatches        int                                 `json:"importedPatches"`
	AlreadyImportedPatches int                                 `json:"alreadyImportedPatches"`
	MissingPatches         []snapshotPatchImportLegacyIssueDTO `json:"missingPatches"`
	ConflictedPatches      []snapshotPatchImportLegacyIssueDTO `json:"conflictedPatches"`
	FailedPatches          []snapshotPatchImportLegacyIssueDTO `json:"failedPatches"`
}

type taskHarnessSessionImportLegacyIssueDTO struct {
	SessionID string `json:"sessionId"`
	HarnessID string `json:"harnessId"`
	Code      string `json:"code"`
}

type taskHarnessSessionsImportLegacyDTO struct {
	ScannedTasks            int                                      `json:"scannedTasks"`
	ReferencedSessions      int                                      `json:"referencedSessions"`
	ImportedSessions        int                                      `json:"importedSessions"`
	AlreadyImportedSessions int                                      `json:"alreadyImportedSessions"`
	MissingSessions         []taskHarnessSessionImportLegacyIssueDTO `json:"missingSessions"`
	ConflictedSessions      []taskHarnessSessionImportLegacyIssueDTO `json:"conflictedSessions"`
	FailedSessions          []taskHarnessSessionImportLegacyIssueDTO `json:"failedSessions"`
}

type legacyResourceImportSkipDTO struct {
	Kind string `json:"kind"`
	Code string `json:"code"`
}

type legacyResourcesImportDTO struct {
	Images    *taskImagesImportLegacyDTO          `json:"images"`
	Snapshots *snapshotPatchesImportLegacyDTO     `json:"snapshots"`
	Sessions  *taskHarnessSessionsImportLegacyDTO `json:"sessions"`
	Skipped   []legacyResourceImportSkipDTO       `json:"skipped"`
}

type snapshotChangedFileDTO struct {
	Path    string `json:"path"`
	Status  string `json:"status"`
	OldPath string `json:"oldPath,omitempty"`
}

type snapshotStatsDTO struct {
	FilesChanged int `json:"filesChanged"`
	Insertions   int `json:"insertions"`
	Deletions    int `json:"deletions"`
}

type snapshotCreateResultDTO struct {
	EventID   string `json:"eventId"`
	CreatedAt string `json:"createdAt"`
}

type taskResourceSessionDTO struct {
	SessionID string `json:"sessionId"`
	HarnessID string `json:"harnessId"`
}

type taskResourceWorktreeDTO struct {
	Slug         string `json:"slug"`
	BranchName   string `json:"branchName"`
	SourceBranch string `json:"sourceBranch"`
	BranchMerged *bool  `json:"branchMerged"`
}

type taskResourceInventoryDTO struct {
	RepoID      string                   `json:"repoId"`
	TaskID      string                   `json:"taskId"`
	TaskTitle   string                   `json:"taskTitle"`
	IsRunning   bool                     `json:"isRunning"`
	SnapshotIDs []string                 `json:"snapshotIds"`
	Images      []taskResourceImageDTO   `json:"images"`
	Sessions    []taskResourceSessionDTO `json:"sessions"`
	Worktree    *taskResourceWorktreeDTO `json:"worktree"`
}

type taskResourceEventPayload struct {
	ID                     string            `json:"id"`
	Type                   string            `json:"type"`
	PatchFileID            string            `json:"patchFileId"`
	FullPatch              string            `json:"fullPatch"`
	Images                 []json.RawMessage `json:"images"`
	Execution              json.RawMessage   `json:"execution"`
	HyperPlanSubExecutions []json.RawMessage `json:"hyperplanSubExecutions"`
}

type taskResourceExecutionPayload struct {
	HarnessID string `json:"harnessId"`
	SessionID string `json:"sessionId"`
}

type taskResourceMetadataPayload struct {
	SessionIDs map[string]string `json:"sessionIds"`
}

type queuedTurnCancelResultDTO struct {
	TaskID       string `json:"taskId"`
	QueuedTurnID string `json:"queuedTurnId"`
	Cancelled    bool   `json:"cancelled"`
}

type queuedTurnEnqueueResultDTO struct {
	TaskID       string        `json:"taskId"`
	QueuedTurnID string        `json:"queuedTurnId"`
	Queued       bool          `json:"queued"`
	Turn         queuedTurnDTO `json:"turn"`
}

type queuedTurnImportLegacyResultDTO struct {
	TaskID       string        `json:"taskId"`
	QueuedTurnID string        `json:"queuedTurnId"`
	Imported     bool          `json:"imported"`
	Turn         queuedTurnDTO `json:"turn"`
}

type queuedTurnReorderResultDTO struct {
	TaskID    string          `json:"taskId"`
	Reordered bool            `json:"reordered"`
	Turns     []queuedTurnDTO `json:"turns"`
}

type queuedTurnUpdatedNotificationDTO struct {
	RepoID string        `json:"repoId"`
	TaskID string        `json:"taskId"`
	Turn   queuedTurnDTO `json:"turn"`
	At     string        `json:"at"`
}

type userDTO struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type selectedTextDTO struct {
	Text        string `json:"text"`
	LinesBefore string `json:"linesBefore"`
	LinesAfter  string `json:"linesAfter"`
}

type commentAnchorDTO struct {
	Source       json.RawMessage `json:"source"`
	SelectedText selectedTextDTO `json:"selectedText"`
	Author       userDTO         `json:"author"`
}

type repoCreateResultDTO struct {
	RepoID    string `json:"repoId"`
	CreatedAt string `json:"createdAt"`
}

type commentCreateResultDTO struct {
	CommentID string `json:"commentId"`
	CreatedAt string `json:"createdAt"`
}

type taskCreateResultDTO struct {
	TaskID    string `json:"taskId"`
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	CreatedAt string `json:"createdAt"`
}

type taskDeleteResultDTO struct {
	RepoID  string `json:"repoId"`
	TaskID  string `json:"taskId"`
	Deleted bool   `json:"deleted"`
}

func Register(runtime *core.Runtime, store *storage.Store, options Options) *Service {
	service := &Service{
		runtime:             runtime,
		store:               store,
		options:             options,
		idempotentMutations: map[string]*idempotentMutationEntry{},
		processes:           map[string]*projectProcessState{},
		terminals:           map[string]*taskTerminalState{},
		agentExecutions:     map[string]*agentExecutionState{},
		runningCrons:        map[string]bool{},
	}
	runtime.RegisterNotification("openade/snapshotChanged")
	runtime.RegisterNotification("openade/repo/updated")
	runtime.RegisterNotification("openade/repo/deleted")
	runtime.RegisterNotification("openade/task/previewChanged")
	runtime.RegisterNotification("openade/task/updated")
	runtime.RegisterNotification("openade/task/deleted")
	runtime.RegisterNotification("openade/queuedTurn/updated")
	runtime.RegisterNotification("openade/workingTasks")
	runtime.RegisterNotification("remote/device/changed")
	runtime.RegisterNotification("process/started")
	runtime.RegisterNotification("process/output")
	runtime.RegisterNotification("process/exit")
	runtime.RegisterNotification("process/error")
	runtime.RegisterNotification("pty/started")
	runtime.RegisterNotification("pty/output")
	runtime.RegisterNotification("pty/exit")
	runtime.RegisterNotification("pty/killed")
	runtime.RegisterNotification("runtime/created")
	runtime.RegisterNotification("runtime/updated")
	runtime.RegisterNotification("runtime/completed")
	runtime.RegisterNotification("runtime/failed")
	runtime.RegisterNotification("runtime/stopped")

	service.markActiveRuntimesOrphaned()

	runtime.Register("runtime/list", service.handleRuntimeList)
	runtime.Register("runtime/read", service.handleRuntimeRead)
	runtime.Register("runtime/reconcile", service.handleRuntimeReconcile)
	runtime.Register("runtime/stop", service.handleRuntimeStop)
	runtime.Register("remote/pairing/start", service.handleRemotePairingStart)
	runtime.Register("remote/device/list", service.handleRemoteDeviceList)
	runtime.Register("remote/device/revoke", service.handleRemoteDeviceRevoke)
	runtime.Register("remote/device/dropAll", service.handleRemoteDeviceDropAll)
	runtime.Register("remote/device/selfRevoke", service.handleRemoteDeviceSelfRevoke)
	runtime.Register("openade/import/legacyResources", service.handleLegacyResourcesImport)
	runtime.Register("openade/settings/mcpServers/read", service.handleMCPServersRead)
	runtime.Register("openade/settings/mcpServers/replace", service.handleMCPServersReplace)
	runtime.Register("openade/settings/mcpServers/upsert", service.handleMCPServerUpsert)
	runtime.Register("openade/settings/mcpServers/delete", service.handleMCPServerDelete)
	runtime.Register("openade/settings/personal/read", service.handlePersonalSettingsRead)
	runtime.Register("openade/settings/personal/replace", service.handlePersonalSettingsReplace)
	runtime.Register("openade/snapshot/read", service.handleSnapshotRead)
	runtime.Register("openade/project/list", service.handleProjectList)
	runtime.Register("openade/project/files/tree", service.handleProjectFilesTree)
	runtime.Register("openade/project/file/read", service.handleProjectFileRead)
	runtime.Register("openade/project/file/write", service.handleProjectFileWrite)
	runtime.Register("openade/project/files/fuzzySearch", service.handleProjectFilesFuzzySearch)
	runtime.Register("openade/project/search", service.handleProjectSearch)
	runtime.Register("openade/project/git/info/read", service.handleProjectGitInfoRead)
	runtime.Register("openade/project/git/branches/read", service.handleProjectGitBranchesRead)
	runtime.Register("openade/project/git/summary/read", service.handleProjectGitSummaryRead)
	runtime.Register("openade/task/git/summary/read", service.handleTaskGitSummaryRead)
	runtime.Register("openade/task/git/scopes/read", service.handleTaskGitScopesRead)
	runtime.Register("openade/task/changes/read", service.handleTaskChangesRead)
	runtime.Register("openade/task/diff/read", service.handleTaskDiffRead)
	runtime.Register("openade/task/filePair/read", service.handleTaskFilePairRead)
	runtime.Register("openade/task/git/log", service.handleTaskGitLog)
	runtime.Register("openade/task/git/commit/files/read", service.handleTaskGitCommitFiles)
	runtime.Register("openade/task/git/fileAtTreeish/read", service.handleTaskGitFileAtTreeish)
	runtime.Register("openade/task/git/commit/filePatch/read", service.handleTaskGitCommitFilePatch)
	runtime.Register("openade/task/git/commit", service.handleTaskGitCommit)
	runtime.Register("openade/project/process/list", service.handleProjectProcessList)
	runtime.Register("openade/project/process/start", service.handleProjectProcessStart)
	runtime.Register("openade/project/process/reconnect", service.handleProjectProcessReconnect)
	runtime.Register("openade/project/process/stop", service.handleProjectProcessStop)
	runtime.Register("openade/cron/installState/read", service.handleCronInstallStateRead)
	runtime.Register("openade/cron/installState/replace", service.handleCronInstallStateReplace)
	runtime.Register("openade/task/terminal/start", service.handleTaskTerminalStart)
	runtime.Register("openade/task/terminal/reconnect", service.handleTaskTerminalReconnect)
	runtime.Register("openade/task/terminal/write", service.handleTaskTerminalWrite)
	runtime.Register("openade/task/terminal/resize", service.handleTaskTerminalResize)
	runtime.Register("openade/task/terminal/stop", service.handleTaskTerminalStop)
	runtime.Register("openade/task/resourceInventory/read", service.handleTaskResourceInventoryRead)
	runtime.Register("openade/task/image/read", service.handleTaskImageRead)
	runtime.Register("openade/task/image/staged/read", service.handleTaskImageStagedRead)
	runtime.Register("openade/task/image/write", service.handleTaskImageWrite)
	runtime.Register("openade/task/image/importLegacy", service.handleTaskImageImportLegacy)
	runtime.Register("openade/task/images/importLegacy", service.handleTaskImagesImportLegacy)
	runtime.Register("openade/task/images/gcStaged", service.handleTaskImagesGCStaged)
	runtime.Register("openade/task/snapshot/patch/read", service.handleTaskSnapshotPatchRead)
	runtime.Register("openade/task/snapshot/index/read", service.handleTaskSnapshotIndexRead)
	runtime.Register("openade/task/snapshot/patch/readSlice", service.handleTaskSnapshotPatchSliceRead)
	runtime.Register("openade/task/snapshots/importLegacy", service.handleTaskSnapshotsImportLegacy)
	runtime.Register("openade/task/sessions/importLegacy", service.handleTaskHarnessSessionsImportLegacy)
	runtime.Register("openade/snapshot/create", service.handleSnapshotCreate)
	runtime.Register("openade/task/list", service.handleTaskList)
	runtime.Register("openade/task/read", service.handleTaskRead)
	runtime.Register("openade/task/create", service.handleTaskCreate)
	runtime.Register("openade/task/metadata/update", service.handleTaskMetadataUpdate)
	runtime.Register("openade/task/usage/recalculate", service.handleTaskUsageRecalculate)
	runtime.Register("openade/task/usage/backfill", service.handleTaskUsageBackfill)
	runtime.Register("openade/task/title/generate", service.handleTaskTitleGenerate)
	runtime.Register("openade/task/environment/setup", service.handleTaskEnvironmentSetup)
	runtime.Register("openade/task/environment/prepare", service.handleTaskEnvironmentPrepare)
	runtime.Register("openade/turn/start", service.handleTurnStart)
	runtime.Register("openade/turn/interrupt", service.handleTurnInterrupt)
	runtime.Register("openade/review/start", service.handleReviewStart)
	runtime.Register("openade/repo/create", service.handleRepoCreate)
	runtime.Register("openade/repo/update", service.handleRepoUpdate)
	runtime.Register("openade/repo/delete", service.handleRepoDelete)
	runtime.Register("openade/comment/create", service.handleCommentCreate)
	runtime.Register("openade/comment/edit", service.handleCommentEdit)
	runtime.Register("openade/comment/delete", service.handleCommentDelete)
	runtime.Register("openade/task/delete", service.handleTaskDelete)
	runtime.Register("openade/action/create", service.handleActionCreate)
	runtime.Register("openade/action/stream/append", service.handleActionStreamAppend)
	runtime.Register("openade/action/complete", service.handleActionComplete)
	runtime.Register("openade/action/error", service.handleActionError)
	runtime.Register("openade/action/stopped", service.handleActionStopped)
	runtime.Register("openade/action/reconcileRuntime", service.handleActionReconcileRuntime)
	runtime.Register("openade/action/execution/update", service.handleActionExecutionUpdate)
	runtime.Register("openade/hyperplan/subExecution/add", service.handleHyperPlanSubExecutionAdd)
	runtime.Register("openade/hyperplan/subExecution/stream/append", service.handleHyperPlanSubExecutionStreamAppend)
	runtime.Register("openade/hyperplan/subExecution/update", service.handleHyperPlanSubExecutionUpdate)
	runtime.Register("openade/hyperplan/reconcileLabels/set", service.handleHyperPlanReconcileLabelsSet)
	runtime.Register("openade/queued-turn/enqueue", service.handleQueuedTurnEnqueue)
	runtime.Register("openade/queued-turn/importLegacy", service.handleQueuedTurnImportLegacy)
	runtime.Register("openade/queued-turn/reorder", service.handleQueuedTurnReorder)
	runtime.Register("openade/queued-turn/cancel", service.handleQueuedTurnCancel)
	return service
}

func (service *Service) runIdempotentMutation(scope string, raw json.RawMessage, action func() (core.JSONPayload, *core.RuntimeError)) (core.JSONPayload, *core.RuntimeError) {
	clientRequestID := clientRequestIDFromRaw(raw)
	if clientRequestID == "" {
		return action()
	}
	key := scope + ":" + clientRequestID
	now := time.Now().UTC()

	service.mu.Lock()
	service.cleanupIdempotentMutationsLocked(now)
	if existing := service.idempotentMutations[key]; existing != nil {
		done := existing.done
		service.mu.Unlock()
		<-done
		return existing.result, existing.runtimeErr
	}
	entry := &idempotentMutationEntry{done: make(chan struct{})}
	service.idempotentMutations[key] = entry
	service.mu.Unlock()

	result, runtimeErr := action()
	service.mu.Lock()
	entry.result = result
	entry.runtimeErr = runtimeErr
	if runtimeErr != nil {
		delete(service.idempotentMutations, key)
	} else {
		entry.expiresAt = time.Now().UTC().Add(idempotentMutationRetention)
	}
	close(entry.done)
	service.mu.Unlock()
	return result, runtimeErr
}

func (service *Service) cleanupIdempotentMutationsLocked(now time.Time) {
	for key, entry := range service.idempotentMutations {
		if entry.expiresAt.IsZero() || now.Before(entry.expiresAt) {
			continue
		}
		delete(service.idempotentMutations, key)
	}
}

func (service *Service) handleSnapshotRead(ctx context.Context, _ *core.Connection, _ json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	projects, runtimeErr := service.projects(ctx)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	version := service.options.Version
	if version == "" {
		version = "go-core"
	}
	hostName := service.options.HostName
	if hostName == "" {
		hostName = "OpenADE Core"
	}
	return snapshotDTO{
		Server: snapshotServerDTO{
			Version:  version,
			HostName: hostName,
			Theme: snapshotTheme{
				Setting:   "system",
				ClassName: "code-theme-light",
				Label:     "Light",
			},
		},
		Repos:          projects,
		WorkingTaskIDs: []string{},
	}, nil
}

func (service *Service) handleSnapshotCreate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/snapshot/create", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.createSnapshot(ctx, raw)
	})
}

func (service *Service) createSnapshot(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		TaskID          string                   `json:"taskId"`
		ActionEventID   string                   `json:"actionEventId"`
		ReferenceBranch string                   `json:"referenceBranch"`
		MergeBaseCommit string                   `json:"mergeBaseCommit"`
		FullPatch       string                   `json:"fullPatch"`
		PatchFileID     string                   `json:"patchFileId"`
		Stats           snapshotStatsDTO         `json:"stats"`
		Files           []snapshotChangedFileDTO `json:"files"`
		EventID         string                   `json:"eventId"`
		CreatedAt       string                   `json:"createdAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	taskID := strings.TrimSpace(params.TaskID)
	if taskID == "" {
		return nil, invalidParams("taskId is required")
	}
	if strings.TrimSpace(params.ActionEventID) == "" {
		return nil, invalidParams("actionEventId is required")
	}
	if strings.TrimSpace(params.ReferenceBranch) == "" {
		return nil, invalidParams("referenceBranch is required")
	}
	if strings.TrimSpace(params.MergeBaseCommit) == "" {
		return nil, invalidParams("mergeBaseCommit is required")
	}
	if params.Stats.FilesChanged < 0 || params.Stats.Insertions < 0 || params.Stats.Deletions < 0 {
		return nil, invalidParams("stats are invalid")
	}
	for _, file := range params.Files {
		if strings.TrimSpace(file.Path) == "" {
			return nil, invalidParams("snapshot file path is required")
		}
		switch file.Status {
		case "added", "deleted", "modified", "renamed":
		default:
			return nil, invalidParams("snapshot file status is invalid")
		}
	}

	task, ok, err := service.store.GetTask(ctx, taskID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	hasActionEvent, runtimeErr := service.taskHasActionEvent(ctx, task.ID, strings.TrimSpace(params.ActionEventID))
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if !hasActionEvent {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Action event not found"}
	}

	createdAt := time.Now().UTC()
	if strings.TrimSpace(params.CreatedAt) != "" {
		parsed, runtimeErr := parseParamTime("createdAt", strings.TrimSpace(params.CreatedAt))
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		createdAt = parsed.UTC()
	}
	eventID := strings.TrimSpace(params.EventID)
	if eventID == "" {
		eventID = "snapshot-" + randomHexID()
	}
	if err := validateSnapshotPatchFileID(eventID); err != nil {
		return nil, invalidParams("eventId is invalid")
	}

	fullPatch := params.FullPatch
	patchFileID := strings.TrimSpace(params.PatchFileID)
	if patchFileID != "" {
		if err := validateSnapshotPatchFileID(patchFileID); err != nil {
			return nil, invalidParams(err.Error())
		}
	}
	if fullPatch != "" {
		if patchFileID == "" {
			patchFileID = eventID
		}
		if runtimeErr := service.writeSnapshotPatchBlob(ctx, patchFileID, fullPatch, createdAt); runtimeErr != nil {
			return nil, runtimeErr
		}
		fullPatch = ""
	}

	payload, runtimeErr := snapshotEventPayloadJSON(snapshotEventPayloadInput{
		EventID:         eventID,
		CreatedAt:       createdAt,
		ActionEventID:   strings.TrimSpace(params.ActionEventID),
		ReferenceBranch: strings.TrimSpace(params.ReferenceBranch),
		MergeBaseCommit: strings.TrimSpace(params.MergeBaseCommit),
		FullPatch:       fullPatch,
		PatchFileID:     patchFileID,
		Stats:           params.Stats,
		Files:           params.Files,
	})
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	_, _, created, err := service.store.WriteTaskEvent(ctx, storage.TaskEventWrite{
		Event: storage.TaskEvent{
			ID:          eventID,
			TaskID:      task.ID,
			Type:        "snapshot",
			Status:      sql.NullString{String: "completed", Valid: true},
			CreatedAt:   createdAt,
			PayloadJSON: sql.NullString{String: string(payload), Valid: true},
		},
		UpdatedAt:        createdAt,
		PreserveExisting: true,
	})
	if err != nil {
		return nil, taskEventWriteRuntimeError(err)
	}
	if created {
		service.runtime.Notify("openade/task/updated", map[string]string{"repoId": task.RepoID, "taskId": task.ID})
		service.runtime.Notify("openade/snapshotChanged", map[string]string{"repoId": task.RepoID})
	}
	return snapshotCreateResultDTO{EventID: eventID, CreatedAt: formatTime(createdAt)}, nil
}

func (service *Service) taskHasActionEvent(ctx context.Context, taskID string, eventID string) (bool, *core.RuntimeError) {
	events, err := service.store.ListTaskEvents(ctx, taskID, true)
	if err != nil {
		return false, handlerError(err)
	}
	for _, event := range events {
		payload, ok := taskResourcePayload(event)
		eventType := event.Type
		if ok && payload.Type != "" {
			eventType = payload.Type
		}
		payloadID := event.ID
		if ok && payload.ID != "" {
			payloadID = payload.ID
		}
		if eventType == "action" && payloadID == eventID {
			return true, nil
		}
	}
	return false, nil
}

func (service *Service) handleProjectList(ctx context.Context, _ *core.Connection, _ json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.projects(ctx)
}

func (service *Service) handleProjectFilesTree(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID           string `json:"repoId"`
		TaskID           string `json:"taskId"`
		Path             string `json:"path"`
		MaxDepth         int    `json:"maxDepth"`
		MaxEntries       int    `json:"maxEntries"`
		IncludeHidden    bool   `json:"includeHidden"`
		IncludeGenerated bool   `json:"includeGenerated"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := host.ValidateRelativePath(params.Path, true); err != nil {
		return nil, invalidParams(err.Error())
	}
	repo, root, runtimeErr := service.projectHostRoot(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, err := host.ListProjectFiles(root, host.FileTreeOptions{
		Path:             params.Path,
		MaxDepth:         params.MaxDepth,
		MaxEntries:       params.MaxEntries,
		IncludeHidden:    params.IncludeHidden,
		IncludeGenerated: params.IncludeGenerated,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	return projectFilesTreeToDTO(repo.ID, params.TaskID, result), nil
}

func (service *Service) handleProjectFileRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID   string `json:"repoId"`
		TaskID   string `json:"taskId"`
		Path     string `json:"path"`
		Encoding string `json:"encoding"`
		MaxBytes int64  `json:"maxBytes"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := host.ValidateRelativePath(params.Path, false); err != nil {
		return nil, invalidParams(err.Error())
	}
	repo, root, runtimeErr := service.projectHostRoot(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, err := host.ReadProjectFile(root, host.FileReadOptions{
		Path:     params.Path,
		Encoding: params.Encoding,
		MaxBytes: params.MaxBytes,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	return projectFileReadToDTO(repo.ID, params.TaskID, result), nil
}

func (service *Service) handleProjectFileWrite(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/project/file/write", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.writeProjectFile(ctx, raw)
	})
}

func (service *Service) writeProjectFile(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID     string `json:"repoId"`
		TaskID     string `json:"taskId"`
		Path       string `json:"path"`
		Encoding   string `json:"encoding"`
		Content    string `json:"content"`
		CreateDirs bool   `json:"createDirs"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := host.ValidateRelativePath(params.Path, false); err != nil {
		return nil, invalidParams(err.Error())
	}
	repo, root, runtimeErr := service.projectHostRoot(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, err := host.WriteProjectFile(root, host.FileWriteOptions{
		Path:       params.Path,
		Encoding:   params.Encoding,
		Content:    params.Content,
		CreateDirs: params.CreateDirs,
	})
	if err != nil {
		if err.Error() == "content is not valid base64" || err.Error() == "path is not a file" {
			return nil, invalidParams(err.Error())
		}
		return nil, handlerError(err)
	}
	return projectFileWriteToDTO(repo.ID, params.TaskID, result), nil
}

func (service *Service) handleProjectFilesFuzzySearch(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID           string `json:"repoId"`
		TaskID           string `json:"taskId"`
		Query            string `json:"query"`
		MatchDirs        bool   `json:"matchDirs"`
		Limit            int    `json:"limit"`
		IncludeHidden    bool   `json:"includeHidden"`
		IncludeGenerated bool   `json:"includeGenerated"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, root, runtimeErr := service.projectHostRoot(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, err := host.FuzzySearchProjectFiles(root, host.FuzzySearchOptions{
		Query:            params.Query,
		MatchDirs:        params.MatchDirs,
		Limit:            params.Limit,
		IncludeHidden:    params.IncludeHidden,
		IncludeGenerated: params.IncludeGenerated,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	return projectFuzzySearchToDTO(repo.ID, params.TaskID, result), nil
}

func (service *Service) handleProjectSearch(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID        string `json:"repoId"`
		TaskID        string `json:"taskId"`
		Query         string `json:"query"`
		Limit         int    `json:"limit"`
		CaseSensitive bool   `json:"caseSensitive"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.Query == "" {
		return nil, invalidParams("query is required")
	}
	repo, root, runtimeErr := service.projectHostRoot(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, err := host.SearchProject(root, host.SearchOptions{
		Query:         params.Query,
		Limit:         params.Limit,
		CaseSensitive: params.CaseSensitive,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	return projectSearchToDTO(repo.ID, params.TaskID, result), nil
}

func (service *Service) handleProjectGitInfoRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	repo, runtimeErr := service.repoByRequest(ctx, raw)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	info, isGitRepo, reason, err := host.ReadGitRepositoryInfo(ctx, repo.Path)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		return projectGitInfoDTO{RepoID: repo.ID, IsGitRepo: false, Error: reason}, nil
	}
	return projectGitInfoDTO{
		RepoID:       repo.ID,
		IsGitRepo:    true,
		RepoRoot:     info.RepoRoot,
		RelativePath: info.RelativePath,
		MainBranch:   info.DefaultBranch,
		HasGhCLI:     info.HasGhCLI,
	}, nil
}

func (service *Service) handleProjectGitBranchesRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID        string `json:"repoId"`
		IncludeRemote bool   `json:"includeRemote"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, runtimeErr := service.repoByID(ctx, params.RepoID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	branches, isGitRepo, _, err := host.ListGitBranches(ctx, repo.Path, params.IncludeRemote)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		return projectGitBranchesDTO{RepoID: repo.ID, Branches: []projectGitBranchDTO{}, DefaultBranch: "main"}, nil
	}
	return projectGitBranchesDTO{
		RepoID:        repo.ID,
		Branches:      projectGitBranchesDTOs(branches.Branches),
		DefaultBranch: branches.DefaultBranch,
	}, nil
}

func (service *Service) handleProjectGitSummaryRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	repo, runtimeErr := service.repoByRequest(ctx, raw)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	summary, isGitRepo, _, err := host.ReadGitSummary(ctx, repo.Path)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		return emptyProjectGitSummaryDTO(repo.ID), nil
	}
	return projectGitSummaryToDTO(repo.ID, summary), nil
}

func (service *Service) handleTaskGitSummaryRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
		TaskID string `json:"taskId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, _, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	summary, isGitRepo, _, err := host.ReadGitSummary(ctx, workDir)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		return emptyTaskGitSummaryDTO(repo.ID, params.TaskID), nil
	}
	return taskGitSummaryToDTO(repo.ID, params.TaskID, summary), nil
}

func (service *Service) handleTaskGitScopesRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID        string `json:"repoId"`
		TaskID        string `json:"taskId"`
		IncludeRemote bool   `json:"includeRemote"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, _, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	branches, isGitRepo, _, err := host.ListGitBranches(ctx, workDir, params.IncludeRemote)
	if err != nil {
		return nil, handlerError(err)
	}
	worktrees, worktreesAreGitRepo, _, err := host.ListGitWorktrees(ctx, workDir)
	if err != nil {
		return nil, handlerError(err)
	}
	if !worktreesAreGitRepo {
		worktrees = []host.GitWorktree{}
	}
	if !isGitRepo {
		return taskGitScopesDTO{
			RepoID:        repo.ID,
			TaskID:        params.TaskID,
			DefaultBranch: "main",
			Scopes:        taskGitScopesDTOs([]host.GitBranch{}, worktrees),
		}, nil
	}
	return taskGitScopesDTO{
		RepoID:        repo.ID,
		TaskID:        params.TaskID,
		DefaultBranch: branches.DefaultBranch,
		Scopes:        taskGitScopesDTOs(branches.Branches, worktrees),
	}, nil
}

func (service *Service) handleTaskChangesRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID      string `json:"repoId"`
		TaskID      string `json:"taskId"`
		FromTreeish string `json:"fromTreeish"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, task, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	fromTreeish, runtimeErr := service.taskFromTreeish(ctx, task, params.FromTreeish)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	files, isGitRepo, _, err := host.ReadGitChanges(ctx, workDir, fromTreeish)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		files = []host.GitChangedFile{}
	}
	return taskChangesDTO{
		RepoID:      repo.ID,
		TaskID:      params.TaskID,
		Files:       gitChangedFilesToDTO(files),
		FromTreeish: fromTreeish,
		ToTreeish:   "",
	}, nil
}

func (service *Service) handleTaskDiffRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID          string `json:"repoId"`
		TaskID          string `json:"taskId"`
		FilePath        string `json:"filePath"`
		OldPath         string `json:"oldPath"`
		FromTreeish     string `json:"fromTreeish"`
		ContextLines    int    `json:"contextLines"`
		AllowTruncation *bool  `json:"allowTruncation"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	filePath, oldPath, runtimeErr := normalizeTaskFilePaths(params.FilePath, params.OldPath)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, task, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	fromTreeish, runtimeErr := service.taskFromTreeish(ctx, task, params.FromTreeish)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	contextLines, runtimeErr := normalizeDiffContextLines(params.ContextLines)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	allowTruncation := true
	if params.AllowTruncation != nil {
		allowTruncation = *params.AllowTruncation
	}
	result, isGitRepo, _, err := host.ReadGitDiff(ctx, workDir, fromTreeish, filePath, oldPath, contextLines, allowTruncation)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		result = host.GitCommitFilePatchResult{}
	}
	return taskDiffToDTO(repo.ID, params.TaskID, filePath, oldPath, fromTreeish, result), nil
}

func (service *Service) handleTaskFilePairRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID      string `json:"repoId"`
		TaskID      string `json:"taskId"`
		FilePath    string `json:"filePath"`
		OldPath     string `json:"oldPath"`
		FromTreeish string `json:"fromTreeish"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	filePath, oldPath, runtimeErr := normalizeTaskFilePaths(params.FilePath, params.OldPath)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, task, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	fromTreeish, runtimeErr := service.taskFromTreeish(ctx, task, params.FromTreeish)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, isGitRepo, _, err := host.ReadGitFilePair(ctx, workDir, fromTreeish, filePath, oldPath)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		result = host.GitFilePairResult{}
	}
	return taskFilePairDTO{
		RepoID:      repo.ID,
		TaskID:      params.TaskID,
		FilePath:    filePath,
		OldPath:     oldPath,
		FromTreeish: fromTreeish,
		ToTreeish:   "",
		Before:      result.Before,
		After:       result.After,
		TooLarge:    result.TooLarge,
	}, nil
}

func (service *Service) handleTaskGitLog(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID  string `json:"repoId"`
		TaskID  string `json:"taskId"`
		ScopeID string `json:"scopeId"`
		Ref     string `json:"ref"`
		Limit   int    `json:"limit"`
		Skip    int    `json:"skip"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.Ref != "" {
		if err := validateGitTreeish("ref", params.Ref); err != nil {
			return nil, invalidParams(err.Error())
		}
	}
	if params.Skip < 0 {
		return nil, invalidParams("skip must be non-negative")
	}
	repo, _, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, params.ScopeID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	limit := params.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	result, isGitRepo, _, err := host.ReadGitLog(ctx, workDir, params.Ref, limit, params.Skip)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		return taskGitLogDTO{RepoID: repo.ID, TaskID: params.TaskID, Commits: []taskGitLogEntryDTO{}, HasMore: false}, nil
	}
	return taskGitLogToDTO(repo.ID, params.TaskID, result), nil
}

func (service *Service) handleTaskGitCommitFiles(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
		TaskID string `json:"taskId"`
		Commit string `json:"commit"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := validateGitTreeish("commit", params.Commit); err != nil {
		return nil, invalidParams(err.Error())
	}
	repo, _, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	files, isGitRepo, _, err := host.ReadGitCommitFiles(ctx, workDir, params.Commit)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		return taskGitCommitFilesDTO{RepoID: repo.ID, TaskID: params.TaskID, Commit: params.Commit, Files: []gitChangedFileDTO{}}, nil
	}
	return taskGitCommitFilesDTO{
		RepoID: repo.ID,
		TaskID: params.TaskID,
		Commit: params.Commit,
		Files:  gitChangedFilesToDTO(files),
	}, nil
}

func (service *Service) handleTaskGitFileAtTreeish(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID   string `json:"repoId"`
		TaskID   string `json:"taskId"`
		Treeish  string `json:"treeish"`
		FilePath string `json:"filePath"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := validateGitTreeish("treeish", params.Treeish); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := host.ValidateRelativePath(params.FilePath, false); err != nil {
		return nil, invalidParams(err.Error())
	}
	repo, _, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, isGitRepo, _, err := host.ReadGitFileAtTreeish(ctx, workDir, params.Treeish, params.FilePath)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		result = host.GitFileAtTreeishResult{Exists: false}
	}
	return taskGitFileAtTreeishDTO{
		RepoID:   repo.ID,
		TaskID:   params.TaskID,
		Treeish:  params.Treeish,
		FilePath: params.FilePath,
		Content:  result.Content,
		Exists:   result.Exists,
		TooLarge: result.TooLarge,
	}, nil
}

func (service *Service) handleTaskGitCommitFilePatch(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID          string `json:"repoId"`
		TaskID          string `json:"taskId"`
		Commit          string `json:"commit"`
		FilePath        string `json:"filePath"`
		OldPath         string `json:"oldPath"`
		ContextLines    int    `json:"contextLines"`
		AllowTruncation *bool  `json:"allowTruncation"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if err := validateGitTreeish("commit", params.Commit); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := host.ValidateRelativePath(params.FilePath, false); err != nil {
		return nil, invalidParams(err.Error())
	}
	if params.OldPath != "" {
		if err := host.ValidateRelativePath(params.OldPath, false); err != nil {
			return nil, invalidParams(err.Error())
		}
	}
	contextLines, runtimeErr := normalizeDiffContextLines(params.ContextLines)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, _, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	allowTruncation := true
	if params.AllowTruncation != nil {
		allowTruncation = *params.AllowTruncation
	}
	filePath := normalizeRequestPath(params.FilePath)
	oldPath := normalizeRequestPath(params.OldPath)
	result, isGitRepo, _, err := host.ReadGitCommitFilePatch(ctx, workDir, params.Commit, filePath, oldPath, contextLines, allowTruncation)
	if err != nil {
		return nil, handlerError(err)
	}
	if !isGitRepo {
		result = host.GitCommitFilePatchResult{}
	}
	return taskGitCommitFilePatchToDTO(repo.ID, params.TaskID, params.Commit, filePath, oldPath, result), nil
}

func (service *Service) handleTaskGitCommit(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/git/commit", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID  string `json:"repoId"`
			TaskID  string `json:"taskId"`
			Message string `json:"message"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		message, runtimeErr := normalizeGitCommitMessage(params.Message)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		repo, _, workDir, runtimeErr := service.taskGitWorkDir(ctx, params.RepoID, params.TaskID, "")
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		result, isGitRepo, reason, err := host.CommitGitChanges(ctx, workDir, message)
		if err != nil {
			return nil, handlerError(err)
		}
		if !isGitRepo {
			result = host.GitCommitResult{Committed: false, Status: "failed", Error: firstNonEmptyString(reason, "not a git repository")}
		}
		return taskGitCommitToDTO(repo.ID, params.TaskID, result), nil
	})
}

func (service *Service) handleProjectProcessList(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
		TaskID string `json:"taskId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, root, runtimeErr := service.projectHostRoot(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	result, err := host.ListProjectProcesses(ctx, root)
	if err != nil {
		return nil, handlerError(err)
	}
	response := projectProcessListToDTO(repo.ID, params.TaskID, result)
	response.Instances = service.projectProcessInstances(repo.ID, params.TaskID)
	return response, nil
}

func (service *Service) handleTaskList(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
	}
	if len(raw) == 0 {
		return nil, invalidParams("params are required")
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, invalidParams("params must be an object")
	}
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	previews, err := service.store.ListTaskPreviews(ctx, params.RepoID)
	if err != nil {
		return nil, handlerError(err)
	}
	return taskPreviewsDTO(previews), nil
}

func (service *Service) handleTaskRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID               string `json:"repoId"`
		TaskID               string `json:"taskId"`
		HydrateSessionEvents bool   `json:"hydrateSessionEvents"`
	}
	if len(raw) == 0 {
		return nil, invalidParams("params are required")
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, invalidParams("params must be an object")
	}
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}

	task, ok, err := service.store.GetTask(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || task.RepoID != params.RepoID {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	events, err := service.store.ListTaskEvents(ctx, params.TaskID, params.HydrateSessionEvents)
	if err != nil {
		return nil, handlerError(err)
	}
	comments, err := service.store.ListComments(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	deviceEnvironments, err := service.store.ListTaskDeviceEnvironments(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	queuedTurns, err := service.store.ListQueuedTurns(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	return taskToDTO(task, events, comments, deviceEnvironments, queuedTurns), nil
}

func (service *Service) handleTaskResourceInventoryRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
		TaskID string `json:"taskId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	repo, runtimeErr := service.repoByID(ctx, params.RepoID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}
	task, ok, err := service.store.GetTask(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || task.RepoID != repo.ID {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	events, err := service.store.ListTaskEvents(ctx, params.TaskID, true)
	if err != nil {
		return nil, handlerError(err)
	}
	isRunning, runtimeErr := service.taskHasActiveRuntime(ctx, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	branchMerged := taskResourceInventoryBranchMerged(ctx, repo, task)
	return taskResourceInventoryToDTO(task, events, isRunning, branchMerged), nil
}

func (service *Service) handleTaskImageRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID  string `json:"repoId"`
		TaskID  string `json:"taskId"`
		ImageID string `json:"imageId"`
		Ext     string `json:"ext"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	params.Ext = strings.ToLower(params.Ext)
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}
	if err := validateTaskImageID(params.ImageID); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := validateTaskImageExt(params.Ext); err != nil {
		return nil, invalidParams(err.Error())
	}

	task, ok, err := service.store.GetTask(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || task.RepoID != params.RepoID {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	events, err := service.store.ListTaskEvents(ctx, params.TaskID, true)
	if err != nil {
		return nil, handlerError(err)
	}
	queuedTurns, err := service.store.ListQueuedTurns(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	image := taskImageReference(events, queuedTurns, params.ImageID, params.Ext)
	if image == nil {
		return emptyTaskImageReadDTO(params.RepoID, params.TaskID, params.ImageID, params.Ext), nil
	}
	blob, ok, err := service.store.GetBlobMetadata(ctx, params.ImageID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || blob.Kind != "task_image" {
		return taskImageReadDTO{RepoID: params.RepoID, TaskID: params.TaskID, ImageID: params.ImageID, Ext: params.Ext, MediaType: image.MediaType, Data: nil}, nil
	}
	data, err := os.ReadFile(blob.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return taskImageReadDTO{RepoID: params.RepoID, TaskID: params.TaskID, ImageID: params.ImageID, Ext: params.Ext, MediaType: firstNonEmptyString(image.MediaType, blob.ContentType.String), Data: nil}, nil
		}
		return nil, handlerError(err)
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	return taskImageReadDTO{
		RepoID:    params.RepoID,
		TaskID:    params.TaskID,
		ImageID:   params.ImageID,
		Ext:       params.Ext,
		MediaType: firstNonEmptyString(image.MediaType, blob.ContentType.String),
		Data:      &encoded,
	}, nil
}

func (service *Service) handleTaskImageWrite(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/image/write", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.writeTaskImage(ctx, raw)
	})
}

func (service *Service) handleTaskImageStagedRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		ImageID string `json:"imageId"`
		Ext     string `json:"ext"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	imageID := strings.TrimSpace(params.ImageID)
	ext := strings.ToLower(strings.TrimSpace(params.Ext))
	if err := validateTaskImageID(imageID); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := validateTaskImageExt(ext); err != nil {
		return nil, invalidParams(err.Error())
	}
	return service.readStagedTaskImage(ctx, imageID, ext)
}

func (service *Service) handleTaskImageImportLegacy(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/image/importLegacy", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.importLegacyTaskImage(ctx, raw)
	})
}

func (service *Service) handleTaskImagesImportLegacy(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/images/importLegacy", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.importLegacyTaskImages(ctx, raw)
	})
}

func (service *Service) handleTaskImagesGCStaged(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/images/gcStaged", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.gcStagedTaskImages(ctx, raw)
	})
}

func (service *Service) handleLegacyResourcesImport(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/import/legacyResources", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.importLegacyResources(ctx, raw)
	})
}

func (service *Service) handleTaskHarnessSessionsImportLegacy(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/sessions/importLegacy", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.importLegacyHarnessSessions(ctx, raw)
	})
}

func (service *Service) writeTaskImage(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		ImageID   string `json:"imageId"`
		Ext       string `json:"ext"`
		MediaType string `json:"mediaType"`
		Data      string `json:"data"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	imageID := strings.TrimSpace(params.ImageID)
	ext := strings.ToLower(strings.TrimSpace(params.Ext))
	mediaType := strings.TrimSpace(params.MediaType)
	if err := validateTaskImageID(imageID); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := validateTaskImageExt(ext); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := validateTaskImageMediaType(ext, mediaType); err != nil {
		return nil, invalidParams(err.Error())
	}
	if strings.TrimSpace(params.Data) == "" {
		return nil, invalidParams("data is required")
	}
	data, err := base64.StdEncoding.DecodeString(params.Data)
	if err != nil {
		return nil, invalidParams("data must be base64")
	}
	if len(data) == 0 {
		return nil, invalidParams("data is required")
	}
	if len(data) > maxTaskImageBlobBytes {
		return nil, invalidParams("data is too large")
	}
	return service.writeTaskImageBlob(ctx, taskImageBlobWriteInput{
		ImageID:   imageID,
		Ext:       ext,
		MediaType: mediaType,
		Data:      data,
		CreatedAt: time.Now().UTC(),
	})
}

func (service *Service) readStagedTaskImage(ctx context.Context, imageID string, ext string) (taskImageStagedReadDTO, *core.RuntimeError) {
	empty := taskImageStagedReadDTO{ImageID: imageID, Ext: ext, Data: nil}
	blob, ok, err := service.store.GetBlobMetadata(ctx, imageID)
	if err != nil {
		return taskImageStagedReadDTO{}, handlerError(err)
	}
	if !ok || blob.Kind != "task_image" || taskImageExtFromBlob(blob) != ext {
		return empty, nil
	}
	data, err := os.ReadFile(blob.Path)
	if err != nil {
		if os.IsNotExist(err) {
			empty.MediaType = blob.ContentType.String
			return empty, nil
		}
		return taskImageStagedReadDTO{}, handlerError(err)
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	return taskImageStagedReadDTO{
		ImageID:   imageID,
		Ext:       ext,
		MediaType: blob.ContentType.String,
		Data:      &encoded,
	}, nil
}

func (service *Service) importLegacyResources(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		DataDir         string `json:"dataDir"`
		ImageDir        string `json:"imageDir"`
		SnapshotDir     string `json:"snapshotDir"`
		ImportSessions  bool   `json:"importSessions"`
		ClaudeConfigDir string `json:"claudeConfigDir"`
		CodexHome       string `json:"codexHome"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	dataDir := strings.TrimSpace(params.DataDir)
	imageDir := strings.TrimSpace(params.ImageDir)
	snapshotDir := strings.TrimSpace(params.SnapshotDir)
	claudeConfigDir := strings.TrimSpace(params.ClaudeConfigDir)
	codexHome := strings.TrimSpace(params.CodexHome)
	importSessions := params.ImportSessions || claudeConfigDir != "" || codexHome != ""
	if dataDir == "" && imageDir == "" && snapshotDir == "" && !importSessions {
		return nil, invalidParams("dataDir, imageDir, snapshotDir, importSessions, claudeConfigDir, or codexHome is required")
	}
	if dataDir != "" {
		if runtimeErr := requireLegacyResourceDir("dataDir", dataDir, "failed to inspect legacy data directory"); runtimeErr != nil {
			return nil, runtimeErr
		}
		if imageDir == "" {
			imageDir = filepath.Join(dataDir, "images")
		}
		if snapshotDir == "" {
			snapshotDir = filepath.Join(dataDir, "snapshots")
		}
	}

	result := legacyResourcesImportDTO{
		Skipped: []legacyResourceImportSkipDTO{},
	}
	if imageDir != "" {
		imageDirExists, runtimeErr := inspectLegacyResourceDir("imageDir", imageDir, "failed to inspect legacy task image directory")
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if imageDirExists {
			images, runtimeErr := service.importLegacyTaskImagesFromDir(ctx, imageDir)
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			result.Images = &images
		} else if strings.TrimSpace(params.ImageDir) != "" {
			return nil, invalidParams("imageDir does not exist")
		} else {
			images, runtimeErr := service.emptyLegacyTaskImagesImportResult(ctx)
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			if images.ReferencedImages == 0 {
				result.Images = &images
			} else {
				result.Skipped = append(result.Skipped, legacyResourceImportSkipDTO{Kind: "images", Code: "source_missing"})
			}
		}
	}
	if snapshotDir != "" {
		snapshotDirExists, runtimeErr := inspectLegacyResourceDir("snapshotDir", snapshotDir, "failed to inspect legacy snapshot patch directory")
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		if snapshotDirExists {
			snapshots, runtimeErr := service.importLegacySnapshotPatchesFromDir(ctx, snapshotDir)
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			result.Snapshots = &snapshots
		} else if strings.TrimSpace(params.SnapshotDir) != "" {
			return nil, invalidParams("snapshotDir does not exist")
		} else {
			snapshots, runtimeErr := service.emptyLegacySnapshotPatchesImportResult(ctx)
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			if snapshots.ReferencedPatches == 0 {
				result.Snapshots = &snapshots
			} else {
				result.Skipped = append(result.Skipped, legacyResourceImportSkipDTO{Kind: "snapshots", Code: "source_missing"})
			}
		}
	}
	if importSessions {
		sessions, runtimeErr := service.importLegacyHarnessSessionsWithRoots(ctx, host.HarnessSessionRoots{
			ClaudeConfigDir: claudeConfigDir,
			CodexHome:       codexHome,
		})
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		result.Sessions = &sessions
	}
	return result, nil
}

func (service *Service) emptyLegacyTaskImagesImportResult(ctx context.Context) (taskImagesImportLegacyDTO, *core.RuntimeError) {
	refs, scannedTasks, runtimeErr := service.referencedTaskImages(ctx)
	if runtimeErr != nil {
		return taskImagesImportLegacyDTO{}, runtimeErr
	}
	return taskImagesImportLegacyDTO{
		ScannedTasks:     scannedTasks,
		ReferencedImages: len(refs),
		MissingImages:    []taskImageImportLegacyIssueDTO{},
		ConflictedImages: []taskImageImportLegacyIssueDTO{},
		FailedImages:     []taskImageImportLegacyIssueDTO{},
	}, nil
}

func (service *Service) emptyLegacySnapshotPatchesImportResult(ctx context.Context) (snapshotPatchesImportLegacyDTO, *core.RuntimeError) {
	patchIDs, scannedTasks, runtimeErr := service.referencedSnapshotPatchIDs(ctx)
	if runtimeErr != nil {
		return snapshotPatchesImportLegacyDTO{}, runtimeErr
	}
	return snapshotPatchesImportLegacyDTO{
		ScannedTasks:      scannedTasks,
		ReferencedPatches: len(patchIDs),
		MissingPatches:    []snapshotPatchImportLegacyIssueDTO{},
		ConflictedPatches: []snapshotPatchImportLegacyIssueDTO{},
		FailedPatches:     []snapshotPatchImportLegacyIssueDTO{},
	}, nil
}

func (service *Service) importLegacyHarnessSessions(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		ClaudeConfigDir string `json:"claudeConfigDir"`
		CodexHome       string `json:"codexHome"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	return service.importLegacyHarnessSessionsWithRoots(ctx, host.HarnessSessionRoots{
		ClaudeConfigDir: strings.TrimSpace(params.ClaudeConfigDir),
		CodexHome:       strings.TrimSpace(params.CodexHome),
	})
}

type taskHarnessSessionReference struct {
	SessionID string
	HarnessID string
	CWDs      []string
}

func (service *Service) importLegacyHarnessSessionsWithRoots(ctx context.Context, roots host.HarnessSessionRoots) (taskHarnessSessionsImportLegacyDTO, *core.RuntimeError) {
	if runtimeErr := validateLegacyHarnessSessionRoots(roots); runtimeErr != nil {
		return taskHarnessSessionsImportLegacyDTO{}, runtimeErr
	}
	refs, scannedTasks, runtimeErr := service.referencedHarnessSessions(ctx)
	if runtimeErr != nil {
		return taskHarnessSessionsImportLegacyDTO{}, runtimeErr
	}
	result := taskHarnessSessionsImportLegacyDTO{
		ScannedTasks:       scannedTasks,
		ReferencedSessions: len(refs),
		MissingSessions:    []taskHarnessSessionImportLegacyIssueDTO{},
		ConflictedSessions: []taskHarnessSessionImportLegacyIssueDTO{},
		FailedSessions:     []taskHarnessSessionImportLegacyIssueDTO{},
	}
	for _, ref := range refs {
		blobID := harnessSessionBlobID(ref.HarnessID, ref.SessionID)
		blob, ok, err := service.store.GetBlobMetadata(ctx, blobID)
		if err != nil {
			return taskHarnessSessionsImportLegacyDTO{}, handlerError(err)
		}
		if ok {
			if blob.Kind != "harness_session" || blob.ContentType.String != harnessSessionContentType {
				result.ConflictedSessions = append(result.ConflictedSessions, taskHarnessSessionIssue(ref, "conflict"))
				continue
			}
			if _, err := os.Stat(blob.Path); err == nil {
				result.AlreadyImportedSessions += 1
				continue
			} else if err != nil && !os.IsNotExist(err) {
				result.FailedSessions = append(result.FailedSessions, taskHarnessSessionIssue(ref, "inspect_existing_failed"))
				continue
			}
		}

		data, readIssue := readLegacyHarnessSessionData(ref, roots)
		if readIssue != "" {
			issue := taskHarnessSessionIssue(ref, readIssue)
			if readIssue == "missing" {
				result.MissingSessions = append(result.MissingSessions, issue)
			} else {
				result.FailedSessions = append(result.FailedSessions, issue)
			}
			continue
		}
		if runtimeErr := service.writeHarnessSessionBlob(ctx, ref, data, time.Now().UTC()); runtimeErr != nil {
			issue := taskHarnessSessionIssue(ref, runtimeErr.Code)
			if runtimeErr.Code == "conflict" {
				result.ConflictedSessions = append(result.ConflictedSessions, issue)
				continue
			}
			result.FailedSessions = append(result.FailedSessions, issue)
			continue
		}
		result.ImportedSessions += 1
	}
	return result, nil
}

func (service *Service) importLegacyTaskImages(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		SourceDir string `json:"sourceDir"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	sourceDir := strings.TrimSpace(params.SourceDir)
	if sourceDir == "" {
		return nil, invalidParams("sourceDir is required")
	}
	if runtimeErr := requireLegacyResourceDir("sourceDir", sourceDir, "failed to inspect legacy task image directory"); runtimeErr != nil {
		return nil, runtimeErr
	}
	return service.importLegacyTaskImagesFromDir(ctx, sourceDir)
}

func (service *Service) importLegacyTaskImagesFromDir(ctx context.Context, sourceDir string) (taskImagesImportLegacyDTO, *core.RuntimeError) {
	refs, scannedTasks, runtimeErr := service.referencedTaskImages(ctx)
	if runtimeErr != nil {
		return taskImagesImportLegacyDTO{}, runtimeErr
	}
	result := taskImagesImportLegacyDTO{
		ScannedTasks:     scannedTasks,
		ReferencedImages: len(refs),
		MissingImages:    []taskImageImportLegacyIssueDTO{},
		ConflictedImages: []taskImageImportLegacyIssueDTO{},
		FailedImages:     []taskImageImportLegacyIssueDTO{},
	}
	for _, ref := range refs {
		mediaType := taskImageMediaTypeForExt(ref.Ext)
		if err := validateTaskImageMediaType(ref.Ext, ref.MediaType); err == nil {
			mediaType = ref.MediaType
		}

		blob, ok, err := service.store.GetBlobMetadata(ctx, ref.ID)
		if err != nil {
			return taskImagesImportLegacyDTO{}, handlerError(err)
		}
		if ok {
			if blob.Kind != "task_image" || blob.ContentType.String != mediaType {
				result.ConflictedImages = append(result.ConflictedImages, taskImageImportLegacyIssueDTO{ImageID: ref.ID, Ext: ref.Ext, Code: "conflict"})
				continue
			}
			if _, err := os.Stat(blob.Path); err == nil {
				result.AlreadyImportedImages += 1
				continue
			} else if err != nil && !os.IsNotExist(err) {
				result.FailedImages = append(result.FailedImages, taskImageImportLegacyIssueDTO{ImageID: ref.ID, Ext: ref.Ext, Code: "inspect_existing_failed"})
				continue
			}
		}

		sourcePath := filepath.Join(sourceDir, ref.ID+"."+ref.Ext)
		data, readIssue := readLegacyTaskImageFile(sourcePath)
		if readIssue != "" {
			issue := taskImageImportLegacyIssueDTO{ImageID: ref.ID, Ext: ref.Ext, Code: readIssue}
			if readIssue == "missing" {
				result.MissingImages = append(result.MissingImages, issue)
			} else {
				result.FailedImages = append(result.FailedImages, issue)
			}
			continue
		}
		if _, runtimeErr := service.writeTaskImageBlob(ctx, taskImageBlobWriteInput{
			ImageID:   ref.ID,
			Ext:       ref.Ext,
			MediaType: mediaType,
			Data:      data,
			CreatedAt: time.Now().UTC(),
		}); runtimeErr != nil {
			issue := taskImageImportLegacyIssueDTO{ImageID: ref.ID, Ext: ref.Ext, Code: runtimeErr.Code}
			if runtimeErr.Code == "conflict" {
				result.ConflictedImages = append(result.ConflictedImages, issue)
				continue
			}
			result.FailedImages = append(result.FailedImages, issue)
			continue
		}
		result.ImportedImages += 1
	}
	return result, nil
}

func (service *Service) gcStagedTaskImages(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		OlderThanMs *int64 `json:"olderThanMs"`
		DryRun      bool   `json:"dryRun"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	olderThan := defaultStagedTaskImageGCAge
	if params.OlderThanMs != nil {
		if *params.OlderThanMs < 0 {
			return nil, invalidParams("olderThanMs must be non-negative")
		}
		const maxStagedImageGCAge = 365 * 24 * time.Hour
		if *params.OlderThanMs > int64(maxStagedImageGCAge/time.Millisecond) {
			return nil, invalidParams("olderThanMs is too large")
		}
		olderThan = time.Duration(*params.OlderThanMs) * time.Millisecond
	}
	refs, scannedTasks, runtimeErr := service.referencedTaskImages(ctx)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	referencedIDs := map[string]bool{}
	for _, ref := range refs {
		referencedIDs[ref.ID] = true
	}
	blobs, err := service.store.ListBlobMetadataByKind(ctx, "task_image")
	if err != nil {
		return nil, handlerError(err)
	}

	cutoff := time.Now().UTC().Add(-olderThan)
	result := taskImagesGCStagedDTO{
		ScannedImages:    len(blobs),
		ScannedTasks:     scannedTasks,
		ReferencedImages: len(refs),
		OlderThanMs:      int64(olderThan / time.Millisecond),
		DryRun:           params.DryRun,
		FailedImages:     []taskImageImportLegacyIssueDTO{},
	}
	for _, blob := range blobs {
		if referencedIDs[blob.ID] || blob.CreatedAt.After(cutoff) {
			result.RetainedImages += 1
			continue
		}
		result.EligibleImages += 1
		if params.DryRun {
			continue
		}
		deleted, err := service.store.DeleteBlobMetadataIfUnchanged(ctx, blob)
		if err != nil {
			result.FailedImages = append(result.FailedImages, taskImageIssueForBlob(blob, "delete_metadata_failed"))
			continue
		}
		if !deleted {
			result.FailedImages = append(result.FailedImages, taskImageIssueForBlob(blob, "metadata_changed"))
			continue
		}
		if code := removeBlobFile(blob); code != "" {
			result.FailedImages = append(result.FailedImages, taskImageIssueForBlob(blob, code))
		}
		result.DeletedImages += 1
	}
	return result, nil
}

func (service *Service) importLegacyTaskImage(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		ImageID    string `json:"imageId"`
		Ext        string `json:"ext"`
		MediaType  string `json:"mediaType"`
		SourcePath string `json:"sourcePath"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	imageID := strings.TrimSpace(params.ImageID)
	ext := strings.ToLower(strings.TrimSpace(params.Ext))
	mediaType := strings.TrimSpace(params.MediaType)
	sourcePath := strings.TrimSpace(params.SourcePath)
	if err := validateTaskImageID(imageID); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := validateTaskImageExt(ext); err != nil {
		return nil, invalidParams(err.Error())
	}
	if err := validateTaskImageMediaType(ext, mediaType); err != nil {
		return nil, invalidParams(err.Error())
	}
	if sourcePath == "" {
		return nil, invalidParams("sourcePath is required")
	}

	data, issue := readLegacyTaskImageFile(sourcePath)
	switch issue {
	case "":
	case "missing":
		return nil, invalidParams("sourcePath does not exist")
	case "not_regular":
		return nil, invalidParams("sourcePath must be a regular file")
	case "empty":
		return nil, invalidParams("sourcePath is empty")
	case "too_large":
		return nil, invalidParams("sourcePath is too large")
	default:
		return nil, handlerError(errorString("failed to read legacy task image"))
	}
	return service.writeTaskImageBlob(ctx, taskImageBlobWriteInput{
		ImageID:   imageID,
		Ext:       ext,
		MediaType: mediaType,
		Data:      data,
		CreatedAt: time.Now().UTC(),
	})
}

func (service *Service) handleTaskSnapshotPatchRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID  string `json:"repoId"`
		TaskID  string `json:"taskId"`
		EventID string `json:"eventId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	snapshot, runtimeErr := service.taskSnapshotEvent(ctx, params.RepoID, params.TaskID, params.EventID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	patch, runtimeErr := service.taskSnapshotPatch(ctx, snapshot)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	return taskSnapshotPatchReadDTO{
		RepoID:      params.RepoID,
		TaskID:      params.TaskID,
		EventID:     params.EventID,
		PatchFileID: snapshot.PatchFileID,
		Patch:       patch,
	}, nil
}

func (service *Service) handleTaskSnapshotIndexRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID  string `json:"repoId"`
		TaskID  string `json:"taskId"`
		EventID string `json:"eventId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	snapshot, runtimeErr := service.taskSnapshotEvent(ctx, params.RepoID, params.TaskID, params.EventID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	patch, runtimeErr := service.taskSnapshotPatch(ctx, snapshot)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	var index *snapshotPatchIndexDTO
	if patch != nil {
		value := buildSnapshotPatchIndex(*patch)
		index = &value
	}
	return taskSnapshotIndexReadDTO{
		RepoID:      params.RepoID,
		TaskID:      params.TaskID,
		EventID:     params.EventID,
		PatchFileID: snapshot.PatchFileID,
		Index:       index,
	}, nil
}

func (service *Service) handleTaskSnapshotPatchSliceRead(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID  string `json:"repoId"`
		TaskID  string `json:"taskId"`
		EventID string `json:"eventId"`
		Start   int    `json:"start"`
		End     int    `json:"end"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.Start < 0 || params.End < params.Start {
		return nil, invalidParams("patch slice range is invalid")
	}
	snapshot, runtimeErr := service.taskSnapshotEvent(ctx, params.RepoID, params.TaskID, params.EventID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	patch, runtimeErr := service.taskSnapshotPatch(ctx, snapshot)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	var sliced *string
	if patch != nil {
		value, runtimeErr := sliceSnapshotPatch(*patch, params.Start, params.End)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		sliced = &value
	}
	return taskSnapshotPatchSliceReadDTO{
		RepoID:      params.RepoID,
		TaskID:      params.TaskID,
		EventID:     params.EventID,
		PatchFileID: snapshot.PatchFileID,
		Patch:       sliced,
	}, nil
}

func (service *Service) handleTaskSnapshotsImportLegacy(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/snapshots/importLegacy", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.importLegacySnapshotPatches(ctx, raw)
	})
}

func (service *Service) importLegacySnapshotPatches(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		SourceDir string `json:"sourceDir"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	sourceDir := strings.TrimSpace(params.SourceDir)
	if sourceDir == "" {
		return nil, invalidParams("sourceDir is required")
	}
	if runtimeErr := requireLegacyResourceDir("sourceDir", sourceDir, "failed to inspect legacy snapshot patch directory"); runtimeErr != nil {
		return nil, runtimeErr
	}
	return service.importLegacySnapshotPatchesFromDir(ctx, sourceDir)
}

func (service *Service) importLegacySnapshotPatchesFromDir(ctx context.Context, sourceDir string) (snapshotPatchesImportLegacyDTO, *core.RuntimeError) {
	patchIDs, scannedTasks, runtimeErr := service.referencedSnapshotPatchIDs(ctx)
	if runtimeErr != nil {
		return snapshotPatchesImportLegacyDTO{}, runtimeErr
	}
	result := snapshotPatchesImportLegacyDTO{
		ScannedTasks:      scannedTasks,
		ReferencedPatches: len(patchIDs),
		MissingPatches:    []snapshotPatchImportLegacyIssueDTO{},
		ConflictedPatches: []snapshotPatchImportLegacyIssueDTO{},
		FailedPatches:     []snapshotPatchImportLegacyIssueDTO{},
	}
	for _, patchFileID := range patchIDs {
		blob, ok, err := service.store.GetBlobMetadata(ctx, patchFileID)
		if err != nil {
			return snapshotPatchesImportLegacyDTO{}, handlerError(err)
		}
		if ok {
			if blob.Kind != "snapshot_patch" || blob.ContentType.String != "text/x-patch" {
				result.ConflictedPatches = append(result.ConflictedPatches, snapshotPatchImportLegacyIssueDTO{PatchFileID: patchFileID, Code: "conflict"})
				continue
			}
			if _, err := os.Stat(blob.Path); err == nil {
				result.AlreadyImportedPatches += 1
				continue
			} else if err != nil && !os.IsNotExist(err) {
				result.FailedPatches = append(result.FailedPatches, snapshotPatchImportLegacyIssueDTO{PatchFileID: patchFileID, Code: "inspect_existing_failed"})
				continue
			}
		}

		sourcePath := filepath.Join(sourceDir, patchFileID+".patch")
		data, readIssue := readLegacySnapshotPatchFile(sourcePath)
		if readIssue != "" {
			issue := snapshotPatchImportLegacyIssueDTO{PatchFileID: patchFileID, Code: readIssue}
			if readIssue == "missing" {
				result.MissingPatches = append(result.MissingPatches, issue)
			} else {
				result.FailedPatches = append(result.FailedPatches, issue)
			}
			continue
		}
		if runtimeErr := service.importLegacySnapshotPatchBlob(ctx, patchFileID, data, time.Now().UTC()); runtimeErr != nil {
			issue := snapshotPatchImportLegacyIssueDTO{PatchFileID: patchFileID, Code: runtimeErr.Code}
			if runtimeErr.Code == "conflict" {
				result.ConflictedPatches = append(result.ConflictedPatches, issue)
				continue
			}
			result.FailedPatches = append(result.FailedPatches, issue)
			continue
		}
		result.ImportedPatches += 1
	}
	return result, nil
}

func (service *Service) handleTaskCreate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/create", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.createTask(ctx, raw)
	})
}

func (service *Service) createTask(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID              string                        `json:"repoId"`
		Input               string                        `json:"input"`
		CreatedBy           userDTO                       `json:"createdBy"`
		DeviceID            string                        `json:"deviceId"`
		Title               string                        `json:"title"`
		TaskID              string                        `json:"taskId"`
		Slug                string                        `json:"slug"`
		CreatedAt           string                        `json:"createdAt"`
		IsolationStrategy   json.RawMessage               `json:"isolationStrategy"`
		EnabledMCPServerIDs []string                      `json:"enabledMcpServerIds"`
		DeviceEnvironment   *deviceEnvironmentDTO         `json:"deviceEnvironment"`
		SetupEvent          *taskEnvironmentSetupEventDTO `json:"setupEvent"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	params.RepoID = strings.TrimSpace(params.RepoID)
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	if params.CreatedBy.ID == "" || params.CreatedBy.Email == "" {
		return nil, invalidParams("createdBy is required")
	}
	params.DeviceID = strings.TrimSpace(params.DeviceID)
	if params.DeviceID == "" {
		return nil, invalidParams("deviceId is required")
	}
	if _, runtimeErr := service.repoByID(ctx, params.RepoID); runtimeErr != nil {
		return nil, runtimeErr
	}

	taskID := strings.TrimSpace(params.TaskID)
	if taskID == "" {
		taskID = openADETaskIDForClientRequest(params.RepoID, clientRequestIDFromRaw(raw))
	}
	if taskID == "" {
		taskID = "task-" + randomHexID()
	}
	slug := strings.TrimSpace(params.Slug)
	if slug == "" {
		slug = randomTaskSlug()
	}
	title := params.Title
	if title == "" {
		title = "New task"
	}
	createdAt := time.Now().UTC()
	if params.CreatedAt != "" {
		parsed, runtimeErr := parseParamTime("createdAt", params.CreatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		createdAt = parsed
	}
	isolationJSON, runtimeErr := taskCreateIsolationJSON(params.IsolationStrategy)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	metadataJSON, runtimeErr := taskCreateMetadataJSON(params.CreatedBy, params.EnabledMCPServerIDs)
	if runtimeErr != nil {
		return nil, runtimeErr
	}

	environment := deviceEnvironmentDTO{
		ID:            params.DeviceID,
		DeviceID:      params.DeviceID,
		SetupComplete: true,
		CreatedAt:     formatTime(createdAt),
		LastUsedAt:    formatTime(createdAt),
	}
	if params.DeviceEnvironment != nil {
		environment = *params.DeviceEnvironment
	}
	setup, runtimeErr := service.taskEnvironmentSetupFromDTO(taskID, environment, params.SetupEvent, createdAt)
	if runtimeErr != nil {
		return nil, runtimeErr
	}

	task, created, err := service.store.CreateTask(ctx, storage.TaskCreate{
		Task: storage.Task{
			ID:            taskID,
			RepoID:        params.RepoID,
			Slug:          slug,
			Title:         title,
			Description:   params.Input,
			IsolationJSON: isolationJSON,
			MetadataJSON:  metadataJSON,
			CreatedAt:     createdAt,
			UpdatedAt:     createdAt,
		},
		DeviceEnvironment: &setup.DeviceEnvironment,
		SetupEvent:        setup.SetupEvent,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	if task.RepoID != params.RepoID {
		return nil, &core.RuntimeError{Code: "conflict", Message: "Task id already belongs to another repository"}
	}
	notification := map[string]string{"repoId": task.RepoID, "taskId": task.ID}
	if created {
		service.runtime.Notify("openade/task/updated", notification)
		service.runtime.Notify("openade/task/previewChanged", notification)
		service.runtime.Notify("openade/snapshotChanged", notification)
	}
	return taskCreateResultDTO{
		TaskID:    task.ID,
		Slug:      task.Slug,
		Title:     task.Title,
		CreatedAt: formatTime(task.CreatedAt),
	}, nil
}

func (service *Service) handleTaskMetadataUpdate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/metadata/update", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.updateTaskMetadata(ctx, raw)
	})
}

func (service *Service) handleTaskEnvironmentSetup(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/environment/setup", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			TaskID            string                        `json:"taskId"`
			DeviceEnvironment deviceEnvironmentDTO          `json:"deviceEnvironment"`
			SetupEvent        *taskEnvironmentSetupEventDTO `json:"setupEvent"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		if params.TaskID == "" {
			return nil, invalidParams("taskId is required")
		}
		setup, runtimeErr := service.taskEnvironmentSetupFromDTO(params.TaskID, params.DeviceEnvironment, params.SetupEvent, time.Now().UTC())
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		task, ok, err := service.store.SetupTaskEnvironment(ctx, setup)
		if err != nil {
			return nil, handlerError(err)
		}
		if !ok {
			return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
		}
		notification := map[string]string{"repoId": task.RepoID, "taskId": task.ID}
		service.runtime.Notify("openade/task/updated", notification)
		service.runtime.Notify("openade/task/previewChanged", notification)
		return mutationOKDTO{OK: true}, nil
	})
}

func (service *Service) handleTaskEnvironmentPrepare(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/environment/prepare", raw, func() (core.JSONPayload, *core.RuntimeError) {
		var params struct {
			RepoID string `json:"repoId"`
			TaskID string `json:"taskId"`
		}
		if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
			return nil, runtimeErr
		}
		repo, task, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		preparedAt := time.Now().UTC()
		result, runtimeErr := service.prepareTaskEnvironment(ctx, repo, task, preparedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		setup, runtimeErr := service.taskEnvironmentSetupFromDTO(task.ID, result.DeviceEnvironment, result.SetupEvent, preparedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		_, ok, err := service.store.SetupTaskEnvironment(ctx, setup)
		if err != nil {
			return nil, handlerError(err)
		}
		if !ok {
			return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
		}
		notification := map[string]string{"repoId": repo.ID, "taskId": task.ID}
		service.runtime.Notify("openade/task/updated", notification)
		service.runtime.Notify("openade/task/previewChanged", notification)
		return result, nil
	})
}

func (service *Service) handleQueuedTurnCancel(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/queued-turn/cancel", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.cancelQueuedTurn(ctx, raw)
	})
}

func (service *Service) handleQueuedTurnEnqueue(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/queued-turn/enqueue", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.enqueueQueuedTurn(ctx, raw)
	})
}

func (service *Service) enqueueQueuedTurn(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID              string          `json:"repoId"`
		TaskID              string          `json:"taskId"`
		QueuedTurnID        string          `json:"queuedTurnId"`
		Type                string          `json:"type"`
		Input               string          `json:"input"`
		CreatedAt           string          `json:"createdAt"`
		EventID             string          `json:"eventId"`
		AppendSystemPrompt  string          `json:"appendSystemPrompt"`
		EnabledMCPServerIDs []string        `json:"enabledMcpServerIds"`
		HarnessID           string          `json:"harnessId"`
		ModelID             string          `json:"modelId"`
		Label               string          `json:"label"`
		IncludeComments     *bool           `json:"includeComments"`
		Images              json.RawMessage `json:"images"`
		Thinking            string          `json:"thinking"`
		FastMode            *bool           `json:"fastMode"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if _, _, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID); runtimeErr != nil {
		return nil, runtimeErr
	}
	params.Type = strings.TrimSpace(params.Type)
	if params.Type != "do" && params.Type != "ask" {
		return nil, invalidParams("type must be do or ask")
	}
	if params.Input == "" {
		return nil, invalidParams("input is required")
	}
	clientRequestID := clientRequestIDFromRaw(raw)
	queuedTurnID := strings.TrimSpace(params.QueuedTurnID)
	if queuedTurnID == "" {
		queuedTurnID = openADEQueuedTurnIDForClientRequest(params.TaskID, clientRequestID)
	}
	if queuedTurnID == "" {
		queuedTurnID = "queued-" + randomHexID()
	}
	createdAt := time.Now().UTC()
	if params.CreatedAt != "" {
		parsed, runtimeErr := parseParamTime("createdAt", params.CreatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		createdAt = parsed
	}
	payload, runtimeErr := queuedTurnPayloadFromParams(queuedTurnPayloadDTO{
		ClientRequestID:     clientRequestID,
		EventID:             strings.TrimSpace(params.EventID),
		AppendSystemPrompt:  params.AppendSystemPrompt,
		EnabledMCPServerIDs: params.EnabledMCPServerIDs,
		HarnessID:           strings.TrimSpace(params.HarnessID),
		ModelID:             strings.TrimSpace(params.ModelID),
		Label:               params.Label,
		IncludeComments:     params.IncludeComments,
		Thinking:            strings.TrimSpace(params.Thinking),
		FastMode:            params.FastMode,
	}, params.Images)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	turn, created, err := service.store.CreateQueuedTurn(ctx, storage.QueuedTurn{
		ID:          queuedTurnID,
		TaskID:      params.TaskID,
		Type:        params.Type,
		Input:       params.Input,
		Status:      "queued",
		PayloadJSON: payload,
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	dto := queuedTurnToDTO(turn)
	if created {
		notification := map[string]string{"repoId": params.RepoID, "taskId": params.TaskID}
		service.runtime.Notify("openade/task/updated", notification)
		service.runtime.Notify("openade/queuedTurn/updated", queuedTurnUpdatedNotificationDTO{
			RepoID: params.RepoID,
			TaskID: params.TaskID,
			Turn:   dto,
			At:     formatTime(time.Now().UTC()),
		})
		go service.drainNextQueuedTurn(context.Background(), params.TaskID)
	}
	return queuedTurnEnqueueResultDTO{
		TaskID:       params.TaskID,
		QueuedTurnID: turn.ID,
		Queued:       turn.Status == "queued",
		Turn:         dto,
	}, nil
}

func (service *Service) handleQueuedTurnImportLegacy(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/queued-turn/importLegacy", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.importLegacyQueuedTurn(ctx, raw)
	})
}

func (service *Service) importLegacyQueuedTurn(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID   string        `json:"repoId"`
		TaskID   string        `json:"taskId"`
		Turn     queuedTurnDTO `json:"turn"`
		Position int64         `json:"position"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if _, _, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID); runtimeErr != nil {
		return nil, runtimeErr
	}
	queuedTurnID := strings.TrimSpace(params.Turn.ID)
	if queuedTurnID == "" {
		return nil, invalidParams("turn.id is required")
	}
	turnType := strings.TrimSpace(params.Turn.Type)
	if turnType != "do" && turnType != "ask" {
		return nil, invalidParams("turn.type must be do or ask")
	}
	if params.Turn.Input == "" {
		return nil, invalidParams("turn.input is required")
	}
	status := strings.TrimSpace(params.Turn.Status)
	if !validQueuedTurnStatus(status) {
		return nil, invalidParams("turn.status is invalid")
	}
	if params.Turn.CreatedAt == "" {
		return nil, invalidParams("turn.createdAt is required")
	}
	createdAt, runtimeErr := parseParamTime("turn.createdAt", params.Turn.CreatedAt)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.Turn.UpdatedAt == "" {
		return nil, invalidParams("turn.updatedAt is required")
	}
	updatedAt, runtimeErr := parseParamTime("turn.updatedAt", params.Turn.UpdatedAt)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	payload, runtimeErr := queuedTurnPayloadJSON(queuedTurnPayloadDTO{
		ClientRequestID:     strings.TrimSpace(params.Turn.ClientRequestID),
		EventID:             strings.TrimSpace(params.Turn.EventID),
		AppendSystemPrompt:  params.Turn.AppendSystemPrompt,
		EnabledMCPServerIDs: params.Turn.EnabledMCPServerIDs,
		HarnessID:           strings.TrimSpace(params.Turn.HarnessID),
		ModelID:             strings.TrimSpace(params.Turn.ModelID),
		Label:               params.Turn.Label,
		IncludeComments:     params.Turn.IncludeComments,
		Images:              params.Turn.Images,
		Thinking:            strings.TrimSpace(params.Turn.Thinking),
		FastMode:            params.Turn.FastMode,
	})
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	turn, imported, err := service.store.CreateQueuedTurn(ctx, storage.QueuedTurn{
		ID:          queuedTurnID,
		TaskID:      params.TaskID,
		Type:        turnType,
		Input:       params.Turn.Input,
		Status:      status,
		Position:    params.Position,
		PayloadJSON: payload,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	dto := queuedTurnToDTO(turn)
	if imported {
		notification := map[string]string{"repoId": params.RepoID, "taskId": params.TaskID}
		service.runtime.Notify("openade/task/updated", notification)
		service.runtime.Notify("openade/queuedTurn/updated", queuedTurnUpdatedNotificationDTO{
			RepoID: params.RepoID,
			TaskID: params.TaskID,
			Turn:   dto,
			At:     formatTime(time.Now().UTC()),
		})
	}
	return queuedTurnImportLegacyResultDTO{
		TaskID:       params.TaskID,
		QueuedTurnID: turn.ID,
		Imported:     imported,
		Turn:         dto,
	}, nil
}

func (service *Service) handleQueuedTurnReorder(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/queued-turn/reorder", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.reorderQueuedTurns(ctx, raw)
	})
}

func (service *Service) reorderQueuedTurns(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID        string   `json:"repoId"`
		TaskID        string   `json:"taskId"`
		QueuedTurnIDs []string `json:"queuedTurnIds"`
		UpdatedAt     string   `json:"updatedAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if _, _, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID); runtimeErr != nil {
		return nil, runtimeErr
	}
	updatedAt := time.Now().UTC()
	if params.UpdatedAt != "" {
		parsed, runtimeErr := parseParamTime("updatedAt", params.UpdatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		updatedAt = parsed
	}
	turns, reordered, err := service.store.ReorderQueuedTurns(ctx, params.TaskID, params.QueuedTurnIDs, updatedAt)
	if err != nil {
		message := err.Error()
		if strings.Contains(message, "not found") {
			return nil, &core.RuntimeError{Code: "not_found", Message: "Queued turn not found"}
		}
		if strings.Contains(message, "not queued") || strings.Contains(message, "required") || strings.Contains(message, "unique") {
			return nil, invalidParams(message)
		}
		return nil, handlerError(err)
	}
	dtos := queuedTurnListDTO(turns)
	if reordered {
		service.runtime.Notify("openade/task/updated", map[string]string{"repoId": params.RepoID, "taskId": params.TaskID})
		for _, dto := range dtos {
			service.runtime.Notify("openade/queuedTurn/updated", queuedTurnUpdatedNotificationDTO{
				RepoID: params.RepoID,
				TaskID: params.TaskID,
				Turn:   dto,
				At:     formatTime(time.Now().UTC()),
			})
		}
	}
	return queuedTurnReorderResultDTO{TaskID: params.TaskID, Reordered: reordered, Turns: dtos}, nil
}

func (service *Service) cancelQueuedTurn(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID       string `json:"repoId"`
		TaskID       string `json:"taskId"`
		QueuedTurnID string `json:"queuedTurnId"`
		UpdatedAt    string `json:"updatedAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}
	if params.QueuedTurnID == "" {
		return nil, invalidParams("queuedTurnId is required")
	}

	task, ok, err := service.store.GetTask(ctx, params.TaskID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || task.RepoID != params.RepoID {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	updatedAt := time.Now().UTC()
	if params.UpdatedAt != "" {
		parsed, runtimeErr := parseParamTime("updatedAt", params.UpdatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		updatedAt = parsed
	}
	turn, _, cancelled, err := service.store.CancelQueuedTurn(ctx, params.TaskID, params.QueuedTurnID, updatedAt)
	if err != nil {
		return nil, handlerError(err)
	}
	if cancelled {
		notification := map[string]string{"repoId": params.RepoID, "taskId": params.TaskID}
		service.runtime.Notify("openade/task/updated", notification)
		service.runtime.Notify("openade/queuedTurn/updated", queuedTurnUpdatedNotificationDTO{
			RepoID: params.RepoID,
			TaskID: params.TaskID,
			Turn:   queuedTurnToDTO(turn),
			At:     formatTime(time.Now().UTC()),
		})
	}
	return queuedTurnCancelResultDTO{TaskID: params.TaskID, QueuedTurnID: params.QueuedTurnID, Cancelled: cancelled}, nil
}

func (service *Service) updateTaskMetadata(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var fields map[string]json.RawMessage
	if len(raw) == 0 {
		return nil, invalidParams("params are required")
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, invalidParams("params must be an object")
	}
	for _, unsupported := range []string{"enabledMcpServerIds", "queuedTurns"} {
		if _, ok := fields[unsupported]; ok {
			return nil, invalidParams(unsupported + " is not supported by OpenADE Core yet")
		}
	}

	var params struct {
		TaskID               string          `json:"taskId"`
		Title                *string         `json:"title"`
		Closed               *bool           `json:"closed"`
		LastViewedAt         *string         `json:"lastViewedAt"`
		LastEventAt          *string         `json:"lastEventAt"`
		CancelledPlanEventID *string         `json:"cancelledPlanEventId"`
		Usage                json.RawMessage `json:"usage"`
		UpdatedAt            *string         `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, invalidParams("params must be an object")
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}

	update := storage.TaskMetadataUpdate{TaskID: params.TaskID}
	if params.Title != nil {
		if title := strings.TrimSpace(*params.Title); title != "" {
			update.Title = &title
		}
	}
	if params.Closed != nil {
		update.Closed = params.Closed
	}
	if params.LastViewedAt != nil {
		parsed, err := parseParamTime("lastViewedAt", *params.LastViewedAt)
		if err != nil {
			return nil, err
		}
		update.LastViewedAtSet = true
		update.LastViewedAt = sql.NullTime{Time: parsed, Valid: true}
	}
	if params.LastEventAt != nil {
		parsed, err := parseParamTime("lastEventAt", *params.LastEventAt)
		if err != nil {
			return nil, err
		}
		update.LastEventAtSet = true
		update.LastEventAt = sql.NullTime{Time: parsed, Valid: true}
	}
	if params.UpdatedAt != nil {
		parsed, err := parseParamTime("updatedAt", *params.UpdatedAt)
		if err != nil {
			return nil, err
		}
		update.UpdatedAt = parsed
	}
	if usage, runtimeErr := compactOptionalObjectJSON("usage", params.Usage); runtimeErr != nil {
		return nil, runtimeErr
	} else if usage.Valid {
		update.UsageJSONSet = true
		update.UsageJSON = usage
	}
	sessionIDsRaw, sessionIDsSet := fields["sessionIds"]
	var sessionIDs map[string]string
	if sessionIDsSet {
		parsed, runtimeErr := taskMetadataSessionIDsParam(sessionIDsRaw)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		sessionIDs = parsed
	}
	if params.CancelledPlanEventID != nil || sessionIDsSet {
		task, ok, err := service.store.GetTask(ctx, params.TaskID)
		if err != nil {
			return nil, handlerError(err)
		}
		if !ok {
			return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
		}
		metadataJSON, runtimeErr := taskMetadataJSONForUpdate(task, sessionIDs, sessionIDsSet, params.CancelledPlanEventID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		update.MetadataJSONSet = true
		update.MetadataJSON = metadataJSON
	}

	task, ok, err := service.store.UpdateTaskMetadata(ctx, update)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	notification := map[string]string{"repoId": task.RepoID, "taskId": task.ID}
	service.runtime.Notify("openade/task/updated", notification)
	service.runtime.Notify("openade/task/previewChanged", notification)
	return mutationOKDTO{OK: true}, nil
}

func (service *Service) handleRepoCreate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/repo/create", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.createRepo(ctx, raw)
	})
}

func (service *Service) createRepo(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID    string  `json:"repoId"`
		Name      string  `json:"name"`
		Path      string  `json:"path"`
		CreatedBy userDTO `json:"createdBy"`
		CreatedAt string  `json:"createdAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.Name == "" {
		return nil, invalidParams("name is required")
	}
	if params.Path == "" {
		return nil, invalidParams("path is required")
	}
	if params.CreatedBy.ID == "" || params.CreatedBy.Email == "" {
		return nil, invalidParams("createdBy is required")
	}
	repoID := strings.TrimSpace(params.RepoID)
	if repoID == "" {
		repoID = "repo-" + randomHexID()
	}
	createdAt := time.Now().UTC()
	if params.CreatedAt != "" {
		parsed, runtimeErr := parseParamTime("createdAt", params.CreatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		createdAt = parsed
	}
	repo := storage.Repo{
		ID:        repoID,
		Name:      params.Name,
		Path:      params.Path,
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}
	if err := service.store.UpsertRepo(ctx, repo); err != nil {
		return nil, handlerError(err)
	}
	service.runtime.Notify("openade/repo/updated", map[string]string{"repoId": repo.ID})
	service.runtime.Notify("openade/snapshotChanged", map[string]string{"repoId": repo.ID})
	return repoCreateResultDTO{RepoID: repo.ID, CreatedAt: formatTime(createdAt)}, nil
}

func (service *Service) handleRepoUpdate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/repo/update", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.updateRepo(ctx, raw)
	})
}

func (service *Service) updateRepo(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID    string `json:"repoId"`
		Name      string `json:"name"`
		Path      string `json:"path"`
		Archived  *bool  `json:"archived"`
		UpdatedAt string `json:"updatedAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	update := storage.RepoMetadataUpdate{RepoID: params.RepoID}
	if params.Name != "" {
		update.Name = &params.Name
	}
	if params.Path != "" {
		update.Path = &params.Path
	}
	update.Archived = params.Archived
	if params.UpdatedAt != "" {
		parsed, runtimeErr := parseParamTime("updatedAt", params.UpdatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		update.UpdatedAt = parsed
	}
	repo, ok, err := service.store.UpdateRepo(ctx, update)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Repository not found"}
	}
	service.runtime.Notify("openade/repo/updated", map[string]string{"repoId": repo.ID})
	service.runtime.Notify("openade/snapshotChanged", map[string]string{"repoId": repo.ID})
	return mutationOKDTO{OK: true}, nil
}

func (service *Service) handleRepoDelete(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/repo/delete", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.deleteRepo(ctx, raw)
	})
}

func (service *Service) deleteRepo(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	deleted, err := service.store.DeleteRepo(ctx, params.RepoID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !deleted {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Repository not found"}
	}
	service.runtime.Notify("openade/repo/deleted", map[string]string{"repoId": params.RepoID})
	service.runtime.Notify("openade/snapshotChanged", map[string]string{"repoId": params.RepoID})
	return mutationOKDTO{OK: true}, nil
}

func (service *Service) handleTaskDelete(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/task/delete", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.deleteTask(ctx, raw)
	})
}

func (service *Service) deleteTask(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		RepoID  string `json:"repoId"`
		TaskID  string `json:"taskId"`
		Options struct {
			DeleteSnapshots bool `json:"deleteSnapshots"`
			DeleteImages    bool `json:"deleteImages"`
			DeleteSessions  bool `json:"deleteSessions"`
			DeleteWorktrees bool `json:"deleteWorktrees"`
		} `json:"options"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.RepoID == "" {
		return nil, invalidParams("repoId is required")
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}
	repo, task, runtimeErr := service.taskRepo(ctx, params.RepoID, params.TaskID)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	worktreesToDelete, runtimeErr := service.taskDeleteWorktreeCleanupTargets(ctx, repo.Path, task, params.Options.DeleteWorktrees)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	sessionsToDelete, runtimeErr := service.taskDeleteSessionCleanup(ctx, repo.Path, task, params.Options.DeleteSessions)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	blobsToDelete, runtimeErr := service.taskDeleteBlobCleanup(ctx, params.TaskID, params.Options.DeleteSnapshots, params.Options.DeleteImages)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	blobIDs := make([]string, 0, len(blobsToDelete))
	for _, blob := range blobsToDelete {
		blobIDs = append(blobIDs, blob.ID)
	}
	deleted, err := service.store.DeleteTaskAndBlobMetadata(ctx, params.RepoID, params.TaskID, blobIDs)
	if err != nil {
		return nil, handlerError(err)
	}
	if !deleted {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	removeBlobFiles(blobsToDelete)
	removeTaskHarnessSessions(sessionsToDelete)
	service.removeTaskWorktrees(ctx, repo.Path, worktreesToDelete)
	notification := map[string]string{"repoId": params.RepoID, "taskId": params.TaskID}
	service.runtime.Notify("openade/task/deleted", notification)
	service.runtime.Notify("openade/task/previewChanged", notification)
	service.runtime.Notify("openade/snapshotChanged", notification)
	return taskDeleteResultDTO{RepoID: params.RepoID, TaskID: params.TaskID, Deleted: true}, nil
}

type taskHarnessSessionCleanup struct {
	session taskResourceSessionDTO
	cwd     string
}

func (service *Service) taskDeleteSessionCleanup(ctx context.Context, cwd string, task storage.Task, deleteSessions bool) ([]taskHarnessSessionCleanup, *core.RuntimeError) {
	if !deleteSessions {
		return nil, nil
	}
	events, err := service.store.ListTaskEvents(ctx, task.ID, true)
	if err != nil {
		return nil, handlerError(err)
	}
	inventory := taskResourceInventoryToDTO(task, events, false, nil)
	cleanups := make([]taskHarnessSessionCleanup, 0, len(inventory.Sessions))
	for _, session := range inventory.Sessions {
		cleanups = append(cleanups, taskHarnessSessionCleanup{session: session, cwd: cwd})
	}
	return cleanups, nil
}

func removeTaskHarnessSessions(cleanups []taskHarnessSessionCleanup) {
	for _, cleanup := range cleanups {
		_, _ = host.DeleteHarnessSession(cleanup.session.HarnessID, cleanup.session.SessionID, cleanup.cwd)
	}
}

func (service *Service) taskDeleteBlobCleanup(ctx context.Context, taskID string, deleteSnapshots bool, deleteImages bool) ([]storage.BlobMetadata, *core.RuntimeError) {
	if !deleteSnapshots && !deleteImages {
		return nil, nil
	}
	events, err := service.store.ListTaskEvents(ctx, taskID, true)
	if err != nil {
		return nil, handlerError(err)
	}
	queuedTurns, err := service.store.ListQueuedTurns(ctx, taskID)
	if err != nil {
		return nil, handlerError(err)
	}
	targetKinds := map[string]string{}
	if deleteSnapshots {
		for _, id := range snapshotPatchBlobIDsFromEvents(events) {
			targetKinds[id] = "snapshot_patch"
		}
	}
	if deleteImages {
		for _, id := range taskImageBlobIDsFromReferences(events, queuedTurns) {
			targetKinds[id] = "task_image"
		}
	}
	if len(targetKinds) == 0 {
		return nil, nil
	}
	shared, runtimeErr := service.sharedTaskBlobReferences(ctx, taskID, targetKinds)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	blobs := []storage.BlobMetadata{}
	for id, kind := range targetKinds {
		if shared[id] {
			continue
		}
		blob, ok, err := service.store.GetBlobMetadata(ctx, id)
		if err != nil {
			return nil, handlerError(err)
		}
		if !ok || blob.Kind != kind {
			continue
		}
		blobs = append(blobs, blob)
	}
	return blobs, nil
}

func (service *Service) taskDeleteWorktreeCleanupTargets(ctx context.Context, repoPath string, task storage.Task, deleteWorktrees bool) ([]host.TaskEnvironmentWorktreeCleanupTarget, *core.RuntimeError) {
	if !deleteWorktrees {
		return nil, nil
	}
	isolation, runtimeErr := taskIsolationStrategy(task)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	if isolation.Type != "worktree" {
		return nil, nil
	}
	if task.Slug == "" {
		return nil, invalidParams("task slug is required for worktree cleanup")
	}
	environments, err := service.store.ListTaskDeviceEnvironments(ctx, task.ID)
	if err != nil {
		return nil, handlerError(err)
	}
	targets := []host.TaskEnvironmentWorktreeCleanupTarget{}
	seen := map[string]bool{}
	addTarget := func(worktreeDir string) *core.RuntimeError {
		target, err := host.NewTaskEnvironmentWorktreeCleanupTarget(task.Slug, worktreeDir, service.options.WorktreeBaseDir)
		if err != nil {
			importedTarget, isGitRepo, reason, importedErr := host.NewImportedTaskEnvironmentWorktreeCleanupTarget(ctx, repoPath, task.Slug, worktreeDir)
			if importedErr != nil {
				return invalidParams(importedErr.Error())
			}
			if !isGitRepo {
				return invalidParams(reason)
			}
			target = importedTarget
		}
		if seen[target.WorktreeDir] {
			return nil
		}
		seen[target.WorktreeDir] = true
		targets = append(targets, target)
		return nil
	}
	for _, environment := range environments {
		if !environment.SetupComplete || !environment.WorktreeDir.Valid || strings.TrimSpace(environment.WorktreeDir.String) == "" {
			continue
		}
		if runtimeErr := addTarget(environment.WorktreeDir.String); runtimeErr != nil {
			return nil, runtimeErr
		}
	}
	if len(targets) == 0 && strings.TrimSpace(service.options.WorktreeBaseDir) != "" {
		if runtimeErr := addTarget(filepath.Join(service.options.WorktreeBaseDir, task.Slug)); runtimeErr != nil {
			return nil, runtimeErr
		}
	}
	return targets, nil
}

func (service *Service) sharedTaskBlobReferences(ctx context.Context, deletedTaskID string, targetKinds map[string]string) (map[string]bool, *core.RuntimeError) {
	taskIDs, err := service.store.ListTaskIDs(ctx)
	if err != nil {
		return nil, handlerError(err)
	}
	shared := map[string]bool{}
	for _, taskID := range taskIDs {
		if taskID == deletedTaskID {
			continue
		}
		events, err := service.store.ListTaskEvents(ctx, taskID, true)
		if err != nil {
			return nil, handlerError(err)
		}
		queuedTurns, err := service.store.ListQueuedTurns(ctx, taskID)
		if err != nil {
			return nil, handlerError(err)
		}
		for _, id := range snapshotPatchBlobIDsFromEvents(events) {
			if targetKinds[id] == "snapshot_patch" {
				shared[id] = true
			}
		}
		for _, id := range taskImageBlobIDsFromReferences(events, queuedTurns) {
			if targetKinds[id] == "task_image" {
				shared[id] = true
			}
		}
	}
	return shared, nil
}

func snapshotPatchBlobIDsFromEvents(events []storage.TaskEvent) []string {
	ids := []string{}
	seen := map[string]bool{}
	for _, event := range events {
		payload, ok := taskResourcePayload(event)
		eventType := event.Type
		if ok && payload.Type != "" {
			eventType = payload.Type
		}
		if eventType != "snapshot" || !ok || payload.PatchFileID == "" {
			continue
		}
		if validateSnapshotPatchFileID(payload.PatchFileID) != nil || seen[payload.PatchFileID] {
			continue
		}
		seen[payload.PatchFileID] = true
		ids = append(ids, payload.PatchFileID)
	}
	return ids
}

func (service *Service) referencedSnapshotPatchIDs(ctx context.Context) ([]string, int, *core.RuntimeError) {
	taskIDs, err := service.store.ListTaskIDs(ctx)
	if err != nil {
		return nil, 0, handlerError(err)
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, taskID := range taskIDs {
		events, err := service.store.ListTaskEvents(ctx, taskID, true)
		if err != nil {
			return nil, 0, handlerError(err)
		}
		for _, id := range snapshotPatchBlobIDsFromEvents(events) {
			if seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, len(taskIDs), nil
}

func taskImageBlobIDsFromReferences(events []storage.TaskEvent, queuedTurns []storage.QueuedTurn) []string {
	ids := []string{}
	seen := map[string]bool{}
	add := func(id string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	for _, event := range events {
		payload, ok := taskResourcePayload(event)
		eventType := event.Type
		if ok && payload.Type != "" {
			eventType = payload.Type
		}
		if eventType != "action" || !ok {
			continue
		}
		for _, image := range taskImageReferences(payload.Images) {
			add(image.ID)
		}
	}
	for _, turn := range queuedTurns {
		for _, image := range taskImageReferencesFromQueuedTurn(turn) {
			add(image.ID)
		}
	}
	return ids
}

func removeBlobFiles(blobs []storage.BlobMetadata) {
	for _, blob := range blobs {
		_ = removeBlobFile(blob)
	}
}

func removeBlobFile(blob storage.BlobMetadata) string {
	if blob.Path == "" {
		return ""
	}
	if err := os.Remove(blob.Path); err != nil && !os.IsNotExist(err) {
		return "delete_file_failed"
	}
	return ""
}

func (service *Service) removeTaskWorktrees(ctx context.Context, repoPath string, targets []host.TaskEnvironmentWorktreeCleanupTarget) {
	for _, target := range targets {
		_, _, _, _ = host.RemoveTaskEnvironmentWorktree(ctx, repoPath, target)
	}
}

func (service *Service) handleCommentCreate(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/comment/create", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.createComment(ctx, raw)
	})
}

func (service *Service) createComment(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		TaskID       string          `json:"taskId"`
		Content      string          `json:"content"`
		Source       json.RawMessage `json:"source"`
		SelectedText selectedTextDTO `json:"selectedText"`
		Author       userDTO         `json:"author"`
		CommentID    string          `json:"commentId"`
		CreatedAt    string          `json:"createdAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}
	if params.Content == "" {
		return nil, invalidParams("content is required")
	}
	if len(params.Content) > 200_000 {
		return nil, invalidParams("content is too long")
	}
	if params.Author.ID == "" || params.Author.Email == "" {
		return nil, invalidParams("author is required")
	}
	source, runtimeErr := compactRequiredObjectRawJSON("source", params.Source)
	if runtimeErr != nil {
		return nil, runtimeErr
	}
	commentID := strings.TrimSpace(params.CommentID)
	if commentID == "" {
		commentID = "comment-" + randomHexID()
	}
	createdAt := time.Now().UTC()
	if params.CreatedAt != "" {
		parsed, runtimeErr := parseParamTime("createdAt", params.CreatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		createdAt = parsed
	}
	anchor, err := json.Marshal(commentAnchorDTO{
		Source:       source,
		SelectedText: params.SelectedText,
		Author:       params.Author,
	})
	if err != nil {
		return nil, handlerError(err)
	}
	if err := service.store.UpsertComment(ctx, storage.Comment{
		ID:         commentID,
		TaskID:     params.TaskID,
		Body:       params.Content,
		AnchorJSON: sql.NullString{String: string(anchor), Valid: true},
		CreatedAt:  createdAt,
		UpdatedAt:  createdAt,
	}); err != nil {
		return nil, handlerError(err)
	}
	if task, ok, err := service.store.GetTask(ctx, params.TaskID); err != nil {
		return nil, handlerError(err)
	} else if ok {
		service.runtime.Notify("openade/task/updated", map[string]string{"repoId": task.RepoID, "taskId": task.ID})
	} else {
		service.runtime.Notify("openade/task/updated", map[string]string{"taskId": params.TaskID})
	}
	return commentCreateResultDTO{CommentID: commentID, CreatedAt: formatTime(createdAt)}, nil
}

func (service *Service) handleCommentEdit(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/comment/edit", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.editComment(ctx, raw)
	})
}

func (service *Service) editComment(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		TaskID    string `json:"taskId"`
		CommentID string `json:"commentId"`
		Content   string `json:"content"`
		UpdatedAt string `json:"updatedAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}
	if params.CommentID == "" {
		return nil, invalidParams("commentId is required")
	}
	if params.Content == "" {
		return nil, invalidParams("content is required")
	}
	if len(params.Content) > 200_000 {
		return nil, invalidParams("content is too long")
	}
	updatedAt := time.Now().UTC()
	if params.UpdatedAt != "" {
		parsed, runtimeErr := parseParamTime("updatedAt", params.UpdatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		updatedAt = parsed
	}
	updated, err := service.store.EditComment(ctx, params.TaskID, params.CommentID, params.Content, updatedAt)
	if err != nil {
		return nil, handlerError(err)
	}
	if !updated {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Comment not found"}
	}
	service.notifyTaskUpdatedForTaskID(ctx, params.TaskID)
	return mutationOKDTO{OK: true}, nil
}

func (service *Service) handleCommentDelete(ctx context.Context, _ *core.Connection, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	return service.runIdempotentMutation("openade/comment/delete", raw, func() (core.JSONPayload, *core.RuntimeError) {
		return service.deleteComment(ctx, raw)
	})
}

func (service *Service) deleteComment(ctx context.Context, raw json.RawMessage) (core.JSONPayload, *core.RuntimeError) {
	var params struct {
		TaskID    string `json:"taskId"`
		CommentID string `json:"commentId"`
		UpdatedAt string `json:"updatedAt"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return nil, runtimeErr
	}
	if params.TaskID == "" {
		return nil, invalidParams("taskId is required")
	}
	if params.CommentID == "" {
		return nil, invalidParams("commentId is required")
	}
	deletedAt := time.Now().UTC()
	if params.UpdatedAt != "" {
		parsed, runtimeErr := parseParamTime("updatedAt", params.UpdatedAt)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		deletedAt = parsed
	}
	deleted, err := service.store.DeleteComment(ctx, params.TaskID, params.CommentID, deletedAt)
	if err != nil {
		return nil, handlerError(err)
	}
	if !deleted {
		return nil, &core.RuntimeError{Code: "not_found", Message: "Comment not found"}
	}
	service.notifyTaskUpdatedForTaskID(ctx, params.TaskID)
	return mutationOKDTO{OK: true}, nil
}

func (service *Service) projects(ctx context.Context) ([]projectDTO, *core.RuntimeError) {
	repos, err := service.store.ListRepos(ctx)
	if err != nil {
		return nil, handlerError(err)
	}
	projects := make([]projectDTO, 0, len(repos))
	for _, repo := range repos {
		previews, err := service.store.ListTaskPreviews(ctx, repo.ID)
		if err != nil {
			return nil, handlerError(err)
		}
		projects = append(projects, projectDTO{
			ID:       repo.ID,
			Name:     repo.Name,
			Path:     repo.Path,
			Archived: repo.Archived,
			Tasks:    taskPreviewsDTO(previews),
		})
	}
	return projects, nil
}

func (service *Service) repoByRequest(ctx context.Context, raw json.RawMessage) (storage.Repo, *core.RuntimeError) {
	var params struct {
		RepoID string `json:"repoId"`
	}
	if runtimeErr := decodeObject(raw, &params); runtimeErr != nil {
		return storage.Repo{}, runtimeErr
	}
	return service.repoByID(ctx, params.RepoID)
}

func (service *Service) repoByID(ctx context.Context, repoID string) (storage.Repo, *core.RuntimeError) {
	if repoID == "" {
		return storage.Repo{}, invalidParams("repoId is required")
	}
	repo, ok, err := service.store.GetRepo(ctx, repoID)
	if err != nil {
		return storage.Repo{}, handlerError(err)
	}
	if !ok {
		return storage.Repo{}, &core.RuntimeError{Code: "not_found", Message: "Repository not found"}
	}
	return repo, nil
}

func (service *Service) projectHostRoot(ctx context.Context, repoID string, taskID string) (storage.Repo, string, *core.RuntimeError) {
	if taskID == "" {
		repo, runtimeErr := service.repoByID(ctx, repoID)
		if runtimeErr != nil {
			return storage.Repo{}, "", runtimeErr
		}
		return repo, repo.Path, nil
	}
	repo, _, workDir, runtimeErr := service.taskWorkDir(ctx, repoID, taskID)
	if runtimeErr != nil {
		return storage.Repo{}, "", runtimeErr
	}
	return repo, workDir, nil
}

func (service *Service) taskRepo(ctx context.Context, repoID string, taskID string) (storage.Repo, storage.Task, *core.RuntimeError) {
	if taskID == "" {
		return storage.Repo{}, storage.Task{}, invalidParams("taskId is required")
	}
	repo, runtimeErr := service.repoByID(ctx, repoID)
	if runtimeErr != nil {
		return storage.Repo{}, storage.Task{}, runtimeErr
	}
	task, ok, err := service.store.GetTask(ctx, taskID)
	if err != nil {
		return storage.Repo{}, storage.Task{}, handlerError(err)
	}
	if !ok || task.RepoID != repo.ID {
		return storage.Repo{}, storage.Task{}, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	return repo, task, nil
}

func (service *Service) taskGitWorkDir(ctx context.Context, repoID string, taskID string, scopeID string) (storage.Repo, storage.Task, string, *core.RuntimeError) {
	repo, task, workDir, runtimeErr := service.taskWorkDir(ctx, repoID, taskID)
	if runtimeErr != nil {
		return storage.Repo{}, storage.Task{}, "", runtimeErr
	}
	scopeID = strings.TrimSpace(scopeID)
	if scopeID == "" || strings.HasPrefix(scopeID, "branch:") {
		return repo, task, workDir, nil
	}
	worktreeID, ok := strings.CutPrefix(scopeID, "worktree:")
	if !ok {
		return storage.Repo{}, storage.Task{}, "", invalidParams("task git scopeId is invalid")
	}
	worktreeID, runtimeErr = normalizeTaskGitWorktreeID(worktreeID)
	if runtimeErr != nil {
		return storage.Repo{}, storage.Task{}, "", runtimeErr
	}
	worktrees, isGitRepo, reason, err := host.ListGitWorktrees(ctx, workDir)
	if err != nil {
		return storage.Repo{}, storage.Task{}, "", handlerError(err)
	}
	if !isGitRepo {
		return storage.Repo{}, storage.Task{}, "", invalidParams(firstNonEmptyString(reason, "task repository is not a git repository"))
	}
	for _, worktree := range worktrees {
		if worktree.WorktreeID == worktreeID {
			return repo, task, worktree.Path, nil
		}
	}
	return storage.Repo{}, storage.Task{}, "", invalidParams("task git worktree scope was not found")
}

func (service *Service) taskWorkDir(ctx context.Context, repoID string, taskID string) (storage.Repo, storage.Task, string, *core.RuntimeError) {
	repo, task, runtimeErr := service.taskRepo(ctx, repoID, taskID)
	if runtimeErr != nil {
		return storage.Repo{}, storage.Task{}, "", runtimeErr
	}
	isolation, runtimeErr := taskIsolationStrategy(task)
	if runtimeErr != nil {
		return storage.Repo{}, storage.Task{}, "", runtimeErr
	}
	if isolation.Type == "head" {
		return repo, task, repo.Path, nil
	}
	if isolation.Type != "worktree" {
		return storage.Repo{}, storage.Task{}, "", invalidParams("task isolationStrategy is unsupported")
	}
	worktreeDir, runtimeErr := service.latestTaskWorktreeDir(ctx, task.ID)
	if runtimeErr != nil {
		return storage.Repo{}, storage.Task{}, "", runtimeErr
	}
	if worktreeDir == "" {
		return storage.Repo{}, storage.Task{}, "", invalidParams("task worktree is not available")
	}
	workDir, runtimeErr := service.preparedTaskWorkDir(ctx, repo.Path, worktreeDir)
	if runtimeErr != nil {
		return storage.Repo{}, storage.Task{}, "", runtimeErr
	}
	return repo, task, workDir, nil
}

func (service *Service) latestTaskWorktreeDir(ctx context.Context, taskID string) (string, *core.RuntimeError) {
	environments, err := service.store.ListTaskDeviceEnvironments(ctx, taskID)
	if err != nil {
		return "", handlerError(err)
	}
	for index := len(environments) - 1; index >= 0; index-- {
		environment := environments[index]
		if environment.SetupComplete && environment.WorktreeDir.Valid && environment.WorktreeDir.String != "" {
			return environment.WorktreeDir.String, nil
		}
	}
	return "", nil
}

func (service *Service) latestTaskMergeBase(ctx context.Context, taskID string) (string, *core.RuntimeError) {
	environments, err := service.store.ListTaskDeviceEnvironments(ctx, taskID)
	if err != nil {
		return "", handlerError(err)
	}
	for index := len(environments) - 1; index >= 0; index-- {
		environment := environments[index]
		if environment.SetupComplete && environment.MergeBaseCommit.Valid && environment.MergeBaseCommit.String != "" {
			return environment.MergeBaseCommit.String, nil
		}
	}
	return "", nil
}

func (service *Service) preparedTaskWorkDir(ctx context.Context, repoPath string, worktreeDir string) (string, *core.RuntimeError) {
	info, isGitRepo, reason, err := host.ReadGitRepositoryInfo(ctx, repoPath)
	if err != nil {
		return "", handlerError(err)
	}
	if !isGitRepo {
		return "", invalidParams(firstNonEmptyString(reason, "task repository is not a git repository"))
	}
	root, err := filepath.Abs(worktreeDir)
	if err != nil {
		return "", invalidParams("task worktree path is invalid")
	}
	workDir := root
	prefix := strings.Trim(strings.ReplaceAll(info.RelativePath, "\\", "/"), "/")
	if prefix != "" {
		segments := strings.Split(prefix, "/")
		for _, segment := range segments {
			if segment == "" || segment == ".." {
				return "", invalidParams("repository relative path is invalid")
			}
		}
		workDir = filepath.Join(root, filepath.FromSlash(prefix))
	}
	relative, err := filepath.Rel(root, workDir)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", invalidParams("task worktree path is invalid")
	}
	return workDir, nil
}

func (service *Service) taskFromTreeish(ctx context.Context, task storage.Task, requested string) (string, *core.RuntimeError) {
	if strings.TrimSpace(requested) != "" {
		if err := validateGitTreeish("fromTreeish", requested); err != nil {
			return "", invalidParams(err.Error())
		}
		return requested, nil
	}
	isolation, runtimeErr := taskIsolationStrategy(task)
	if runtimeErr != nil {
		return "", runtimeErr
	}
	if isolation.Type == "worktree" {
		mergeBase, runtimeErr := service.latestTaskMergeBase(ctx, task.ID)
		if runtimeErr != nil {
			return "", runtimeErr
		}
		if mergeBase != "" {
			return mergeBase, nil
		}
	}
	return "HEAD", nil
}

func (service *Service) prepareTaskEnvironment(ctx context.Context, repo storage.Repo, task storage.Task, createdAt time.Time) (taskEnvironmentPrepareResultDTO, *core.RuntimeError) {
	isolation, runtimeErr := taskIsolationStrategy(task)
	if runtimeErr != nil {
		return taskEnvironmentPrepareResultDTO{}, runtimeErr
	}
	createdAtText := formatTime(createdAt)
	if isolation.Type == "" || isolation.Type == "head" {
		environment := deviceEnvironmentDTO{
			ID:            headlessRuntimeDeviceID,
			DeviceID:      headlessRuntimeDeviceID,
			SetupComplete: true,
			CreatedAt:     createdAtText,
			LastUsedAt:    createdAtText,
		}
		return taskEnvironmentPrepareResultDTO{
			RepoID:            repo.ID,
			TaskID:            task.ID,
			DeviceEnvironment: environment,
			Cwd:               repo.Path,
			RootPath:          repo.Path,
		}, nil
	}
	if isolation.Type != "worktree" {
		return taskEnvironmentPrepareResultDTO{}, invalidParams("task isolationStrategy is unsupported")
	}
	if task.Slug == "" {
		return taskEnvironmentPrepareResultDTO{}, invalidParams("task slug is required for environment setup")
	}
	worktree, isGitRepo, reason, err := host.PrepareTaskEnvironmentWorktree(ctx, repo.Path, task.Slug, isolation.SourceBranch, service.options.WorktreeBaseDir)
	if err != nil {
		return taskEnvironmentPrepareResultDTO{}, handlerError(err)
	}
	if !isGitRepo {
		return taskEnvironmentPrepareResultDTO{}, handlerError(errorString(firstNonEmptyString(reason, "not a git repository")))
	}
	environment := deviceEnvironmentDTO{
		ID:              headlessRuntimeDeviceID,
		DeviceID:        headlessRuntimeDeviceID,
		WorktreeDir:     worktree.WorktreeDir,
		SetupComplete:   true,
		MergeBaseCommit: worktree.MergeBaseCommit,
		CreatedAt:       createdAtText,
		LastUsedAt:      createdAtText,
	}
	setupEvent := &taskEnvironmentSetupEventDTO{
		EventID:     "setup-" + headlessRuntimeDeviceID,
		WorktreeID:  task.Slug,
		DeviceID:    headlessRuntimeDeviceID,
		WorkingDir:  worktree.WorkingDir,
		SetupOutput: taskEnvironmentSetupOutput(worktree),
		CreatedAt:   createdAtText,
		CompletedAt: createdAtText,
	}
	return taskEnvironmentPrepareResultDTO{
		RepoID:            repo.ID,
		TaskID:            task.ID,
		DeviceEnvironment: environment,
		SetupEvent:        setupEvent,
		Cwd:               worktree.WorkingDir,
		RootPath:          worktree.RootPath,
	}, nil
}

func (service *Service) taskEnvironmentSetupFromDTO(taskID string, environment deviceEnvironmentDTO, setupEvent *taskEnvironmentSetupEventDTO, updatedAt time.Time) (storage.TaskEnvironmentSetup, *core.RuntimeError) {
	if environment.ID == "" {
		return storage.TaskEnvironmentSetup{}, invalidParams("deviceEnvironment.id is required")
	}
	if environment.DeviceID == "" {
		return storage.TaskEnvironmentSetup{}, invalidParams("deviceEnvironment.deviceId is required")
	}
	createdAt, runtimeErr := parseParamTime("deviceEnvironment.createdAt", environment.CreatedAt)
	if runtimeErr != nil {
		return storage.TaskEnvironmentSetup{}, runtimeErr
	}
	lastUsedAt, runtimeErr := parseParamTime("deviceEnvironment.lastUsedAt", environment.LastUsedAt)
	if runtimeErr != nil {
		return storage.TaskEnvironmentSetup{}, runtimeErr
	}
	setup := storage.TaskEnvironmentSetup{
		TaskID: taskID,
		DeviceEnvironment: storage.TaskDeviceEnvironment{
			ID:              environment.ID,
			TaskID:          taskID,
			DeviceID:        environment.DeviceID,
			WorktreeDir:     optionalNullString(environment.WorktreeDir),
			SetupComplete:   environment.SetupComplete,
			MergeBaseCommit: optionalNullString(environment.MergeBaseCommit),
			CreatedAt:       createdAt,
			LastUsedAt:      lastUsedAt,
		},
		UpdatedAt: updatedAt,
	}
	if setupEvent != nil {
		event, runtimeErr := setupTaskEventFromDTO(taskID, *setupEvent, updatedAt)
		if runtimeErr != nil {
			return storage.TaskEnvironmentSetup{}, runtimeErr
		}
		setup.SetupEvent = &event
	}
	return setup, nil
}

func setupTaskEventFromDTO(taskID string, setupEvent taskEnvironmentSetupEventDTO, fallbackTime time.Time) (storage.TaskEvent, *core.RuntimeError) {
	if setupEvent.WorktreeID == "" {
		return storage.TaskEvent{}, invalidParams("setupEvent.worktreeId is required")
	}
	if setupEvent.DeviceID == "" {
		return storage.TaskEvent{}, invalidParams("setupEvent.deviceId is required")
	}
	if setupEvent.WorkingDir == "" {
		return storage.TaskEvent{}, invalidParams("setupEvent.workingDir is required")
	}
	eventID := setupEvent.EventID
	if eventID == "" {
		eventID = "setup-" + randomHexID()
	}
	createdAt := fallbackTime
	if setupEvent.CreatedAt != "" {
		parsed, runtimeErr := parseParamTime("setupEvent.createdAt", setupEvent.CreatedAt)
		if runtimeErr != nil {
			return storage.TaskEvent{}, runtimeErr
		}
		createdAt = parsed
	}
	completedAt := createdAt
	if setupEvent.CompletedAt != "" {
		parsed, runtimeErr := parseParamTime("setupEvent.completedAt", setupEvent.CompletedAt)
		if runtimeErr != nil {
			return storage.TaskEvent{}, runtimeErr
		}
		completedAt = parsed
	}
	payload := setupEnvironmentEventPayloadDTO{
		ID:          eventID,
		Type:        "setup_environment",
		Status:      "completed",
		CreatedAt:   formatTime(createdAt),
		CompletedAt: formatTime(completedAt),
		UserInput:   "Environment setup",
		WorktreeID:  setupEvent.WorktreeID,
		DeviceID:    setupEvent.DeviceID,
		WorkingDir:  setupEvent.WorkingDir,
		SetupOutput: setupEvent.SetupOutput,
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return storage.TaskEvent{}, handlerError(err)
	}
	return storage.TaskEvent{
		ID:          eventID,
		TaskID:      taskID,
		Type:        "setup_environment",
		Status:      sql.NullString{String: "completed", Valid: true},
		CreatedAt:   createdAt,
		PayloadJSON: sql.NullString{String: string(payloadJSON), Valid: true},
	}, nil
}

type setupEnvironmentEventPayloadDTO struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	CompletedAt string `json:"completedAt"`
	UserInput   string `json:"userInput"`
	WorktreeID  string `json:"worktreeId"`
	DeviceID    string `json:"deviceId"`
	WorkingDir  string `json:"workingDir"`
	SetupOutput string `json:"setupOutput,omitempty"`
}

func taskEnvironmentSetupOutput(worktree host.TaskEnvironmentWorktree) string {
	lines := []string{
		"Worktree: " + worktree.WorktreeDir,
		"Working directory: " + worktree.WorkingDir,
		"Branch: " + worktree.SourceBranch,
	}
	if worktree.MergeBaseCommit != "" {
		mergeBase := worktree.MergeBaseCommit
		if len(mergeBase) > 8 {
			mergeBase = mergeBase[:8]
		}
		lines = append(lines, "Merge base: "+mergeBase)
	}
	return strings.Join(lines, "\n")
}

type taskIsolationStrategyDTO struct {
	Type         string `json:"type"`
	SourceBranch string `json:"sourceBranch"`
}

type taskCreateMetadataDTO struct {
	SessionIDs           map[string]string `json:"sessionIds"`
	CreatedBy            userDTO           `json:"createdBy"`
	EnabledMCPServerIDs  []string          `json:"enabledMcpServerIds,omitempty"`
	CancelledPlanEventID string            `json:"cancelledPlanEventId,omitempty"`
}

func taskCreateIsolationJSON(raw json.RawMessage) (sql.NullString, *core.RuntimeError) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" || strings.TrimSpace(string(raw)) == "null" {
		return sql.NullString{String: `{"type":"head"}`, Valid: true}, nil
	}
	compacted, runtimeErr := compactOptionalObjectJSON("isolationStrategy", raw)
	if runtimeErr != nil {
		return sql.NullString{}, runtimeErr
	}
	if !compacted.Valid {
		return sql.NullString{String: `{"type":"head"}`, Valid: true}, nil
	}
	var isolation taskIsolationStrategyDTO
	if err := json.Unmarshal([]byte(compacted.String), &isolation); err != nil {
		return sql.NullString{}, invalidParams("isolationStrategy must be an object")
	}
	isolation.Type = strings.TrimSpace(isolation.Type)
	isolation.SourceBranch = strings.TrimSpace(isolation.SourceBranch)
	if isolation.Type == "" {
		isolation.Type = "head"
	}
	if isolation.Type != "head" && isolation.Type != "worktree" {
		return sql.NullString{}, invalidParams("isolationStrategy.type must be head or worktree")
	}
	if isolation.Type == "worktree" && isolation.SourceBranch == "" {
		return sql.NullString{}, invalidParams("isolationStrategy.sourceBranch is required for worktree tasks")
	}
	normalized, err := json.Marshal(isolation)
	if err != nil {
		return sql.NullString{}, handlerError(err)
	}
	return sql.NullString{String: string(normalized), Valid: true}, nil
}

func taskCreateMetadataJSON(createdBy userDTO, enabledMCPServerIDs []string) (sql.NullString, *core.RuntimeError) {
	normalizedIDs := []string{}
	for _, id := range enabledMCPServerIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			return sql.NullString{}, invalidParams("enabledMcpServerIds must not contain empty ids")
		}
		normalizedIDs = append(normalizedIDs, trimmed)
	}
	payload := taskCreateMetadataDTO{
		SessionIDs:          map[string]string{},
		CreatedBy:           createdBy,
		EnabledMCPServerIDs: normalizedIDs,
	}
	return taskMetadataJSON(payload)
}

func taskMetadataJSONForUpdate(task storage.Task, sessionIDs map[string]string, sessionIDsSet bool, cancelledPlanEventID *string) (sql.NullString, *core.RuntimeError) {
	metadata := taskMetadataFromTask(task)
	if sessionIDsSet {
		merged := map[string]string{}
		for key, sessionID := range metadata.SessionIDs {
			merged[key] = sessionID
		}
		for key, sessionID := range sessionIDs {
			trimmedKey := strings.TrimSpace(key)
			trimmedSessionID := strings.TrimSpace(sessionID)
			if trimmedKey != "" && trimmedSessionID != "" {
				merged[trimmedKey] = trimmedSessionID
			}
		}
		metadata.SessionIDs = nonEmptyStringMap(merged)
	}
	if cancelledPlanEventID != nil {
		metadata.CancelledPlanEventID = strings.TrimSpace(*cancelledPlanEventID)
	}
	return taskMetadataJSON(metadata)
}

func taskMetadataSessionIDsParam(raw json.RawMessage) (map[string]string, *core.RuntimeError) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || !strings.HasPrefix(trimmed, "{") {
		return nil, invalidParams("sessionIds must be an object")
	}
	var sessionIDs map[string]string
	if err := json.Unmarshal(raw, &sessionIDs); err != nil {
		return nil, invalidParams("sessionIds must be an object of strings")
	}
	return sessionIDs, nil
}

func taskMetadataJSON(metadata taskCreateMetadataDTO) (sql.NullString, *core.RuntimeError) {
	metadata.CreatedBy.ID = strings.TrimSpace(metadata.CreatedBy.ID)
	metadata.CreatedBy.Email = strings.TrimSpace(metadata.CreatedBy.Email)
	metadata.EnabledMCPServerIDs = nonEmptyStringSlice(metadata.EnabledMCPServerIDs)
	metadata.SessionIDs = nonEmptyStringMap(metadata.SessionIDs)
	metadata.CancelledPlanEventID = strings.TrimSpace(metadata.CancelledPlanEventID)
	if metadata.SessionIDs == nil {
		metadata.SessionIDs = map[string]string{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return sql.NullString{}, handlerError(err)
	}
	return sql.NullString{String: string(encoded), Valid: true}, nil
}

func queuedTurnPayloadFromParams(payload queuedTurnPayloadDTO, images json.RawMessage) (sql.NullString, *core.RuntimeError) {
	compactedImages, runtimeErr := compactOptionalArrayParam("images", images)
	if runtimeErr != nil {
		return sql.NullString{}, runtimeErr
	}
	payload.Images = compactedImages
	return queuedTurnPayloadJSON(payload)
}

func queuedTurnPayloadJSON(payload queuedTurnPayloadDTO) (sql.NullString, *core.RuntimeError) {
	normalizedIDs := []string{}
	for _, id := range payload.EnabledMCPServerIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			return sql.NullString{}, invalidParams("enabledMcpServerIds must not contain empty ids")
		}
		normalizedIDs = append(normalizedIDs, trimmed)
	}
	payload.EnabledMCPServerIDs = normalizedIDs
	if payload.Thinking != "" && validThinking(payload.Thinking) == "" {
		return sql.NullString{}, invalidParams("thinking must be low, med, high, or max")
	}
	if payload.Images != nil {
		payload.Images = compactOptionalArrayRawJSON(payload.Images)
		if payload.Images == nil {
			return sql.NullString{}, invalidParams("images must be an array")
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return sql.NullString{}, handlerError(err)
	}
	return sql.NullString{String: string(encoded), Valid: true}, nil
}

func validQueuedTurnStatus(status string) bool {
	switch status {
	case "queued", "running", "completed", "error", "stopped", "cancelled":
		return true
	default:
		return false
	}
}

func openADETaskIDForClientRequest(repoID string, clientRequestID string) string {
	if strings.TrimSpace(clientRequestID) == "" {
		return ""
	}
	hash := sha256.Sum256([]byte(repoID + "\x00" + clientRequestID))
	return "task-" + hex.EncodeToString(hash[:])[:26]
}

func openADEQueuedTurnIDForClientRequest(taskID string, clientRequestID string) string {
	if strings.TrimSpace(clientRequestID) == "" {
		return ""
	}
	hash := sha256.Sum256([]byte(taskID + "\x00" + clientRequestID))
	return "queued-" + hex.EncodeToString(hash[:])[:26]
}

func randomTaskSlug() string {
	id := randomHexID()
	if len(id) > 8 {
		id = id[:8]
	}
	return "task-" + id
}

func taskIsolationStrategy(task storage.Task) (taskIsolationStrategyDTO, *core.RuntimeError) {
	if !task.IsolationJSON.Valid || strings.TrimSpace(task.IsolationJSON.String) == "" {
		return taskIsolationStrategyDTO{Type: "head"}, nil
	}
	var isolation taskIsolationStrategyDTO
	if err := json.Unmarshal([]byte(task.IsolationJSON.String), &isolation); err != nil {
		return taskIsolationStrategyDTO{}, invalidParams("task isolationStrategy is invalid")
	}
	isolation.Type = strings.TrimSpace(isolation.Type)
	isolation.SourceBranch = strings.TrimSpace(isolation.SourceBranch)
	if isolation.Type == "" {
		isolation.Type = "head"
	}
	return isolation, nil
}

func validateGitTreeish(field string, value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return errorString(field + " is required")
	}
	if trimmed != value || len(trimmed) > 512 || strings.ContainsAny(trimmed, "\x00: \t\r\n") || strings.Contains(trimmed, "..") || strings.HasPrefix(trimmed, "-") {
		return errorString(field + " is invalid")
	}
	return nil
}

func normalizeTaskFilePaths(filePath string, oldPath string) (string, string, *core.RuntimeError) {
	if err := host.ValidateRelativePath(filePath, false); err != nil {
		return "", "", invalidParams(err.Error())
	}
	if oldPath != "" {
		if err := host.ValidateRelativePath(oldPath, false); err != nil {
			return "", "", invalidParams(err.Error())
		}
	}
	return normalizeRequestPath(filePath), normalizeRequestPath(oldPath), nil
}

func normalizeDiffContextLines(value int) (int, *core.RuntimeError) {
	if value == 0 {
		return 3, nil
	}
	switch value {
	case 1, 3, 10, 25, 100:
		return value, nil
	default:
		return 0, invalidParams("contextLines is invalid")
	}
}

func normalizeGitCommitMessage(value string) (string, *core.RuntimeError) {
	message := strings.TrimSpace(value)
	if message == "" || len(message) > 10000 || strings.Contains(message, "\x00") {
		return "", invalidParams("message is invalid")
	}
	return message, nil
}

func normalizeTaskGitWorktreeID(value string) (string, *core.RuntimeError) {
	worktreeID := strings.TrimSpace(value)
	if worktreeID == "" || worktreeID != value || len(worktreeID) > 255 || strings.ContainsAny(worktreeID, "\x00\r\n/\\") || worktreeID == "." || worktreeID == ".." || strings.HasPrefix(worktreeID, "-") {
		return "", invalidParams("task git worktree scopeId is invalid")
	}
	return worktreeID, nil
}

func normalizeRequestPath(pathValue string) string {
	return strings.ReplaceAll(pathValue, "\\", "/")
}

type errorString string

func (err errorString) Error() string {
	return string(err)
}

func (service *Service) notifyTaskUpdatedForTaskID(ctx context.Context, taskID string) {
	task, ok, err := service.store.GetTask(ctx, taskID)
	if err == nil && ok {
		service.runtime.Notify("openade/task/updated", map[string]string{"repoId": task.RepoID, "taskId": task.ID})
		return
	}
	service.runtime.Notify("openade/task/updated", map[string]string{"taskId": taskID})
}

func taskPreviewsDTO(previews []storage.TaskPreview) []taskPreviewDTO {
	result := make([]taskPreviewDTO, 0, len(previews))
	for _, preview := range previews {
		result = append(result, taskPreviewDTO{
			ID:           preview.TaskID,
			Slug:         preview.Slug,
			Title:        preview.Title,
			Closed:       preview.Closed,
			CreatedAt:    formatTime(preview.CreatedAt),
			LastEvent:    decodeNullableRawJSON(preview.LastEventJSON),
			Usage:        decodeNullableRawJSON(preview.UsageJSON),
			LastViewedAt: formatNullTime(preview.LastViewedAt),
			LastEventAt:  formatNullTime(preview.LastEventAt),
		})
	}
	return result
}

func projectFilesTreeToDTO(repoID string, taskID string, result host.FileTreeResult) projectFilesTreeDTO {
	entries := make([]projectFileTreeEntryDTO, 0, len(result.Entries))
	for _, entry := range result.Entries {
		entries = append(entries, projectFileTreeEntryDTO{
			Path:    entry.Path,
			Name:    entry.Name,
			Type:    entry.Type,
			Size:    entry.Size,
			MtimeMs: entry.MtimeMs,
		})
	}
	return projectFilesTreeDTO{
		RepoID:    repoID,
		TaskID:    taskID,
		Path:      result.Path,
		Entries:   entries,
		Truncated: result.Truncated,
	}
}

func projectFileReadToDTO(repoID string, taskID string, result host.FileReadResult) projectFileReadDTO {
	return projectFileReadDTO{
		RepoID:      repoID,
		TaskID:      taskID,
		Path:        result.Path,
		Encoding:    result.Encoding,
		Size:        result.Size,
		TooLarge:    result.TooLarge,
		Content:     result.Content,
		IsReadable:  result.IsReadable,
		IsBinary:    result.IsBinary,
		MediaType:   result.MediaType,
		PreviewKind: result.PreviewKind,
	}
}

func projectFileWriteToDTO(repoID string, taskID string, result host.FileWriteResult) projectFileWriteDTO {
	return projectFileWriteDTO{
		RepoID: repoID,
		TaskID: taskID,
		Path:   result.Path,
		Size:   result.Size,
	}
}

func projectFuzzySearchToDTO(repoID string, taskID string, result host.FuzzySearchResult) projectFuzzySearchDTO {
	return projectFuzzySearchDTO{
		RepoID:    repoID,
		TaskID:    taskID,
		Results:   result.Results,
		Truncated: result.Truncated,
		Source:    "filesystem",
		TreeMatch: projectFuzzyTreeMatchToDTO(result.TreeMatch),
	}
}

func projectFuzzyTreeMatchToDTO(match *host.FuzzyTreeMatch) *projectFuzzyTreeMatchDTO {
	if match == nil {
		return nil
	}
	children := make([]projectFuzzyTreeChildDTO, 0, len(match.Children))
	for _, child := range match.Children {
		children = append(children, projectFuzzyTreeChildDTO{
			Name:     child.Name,
			IsDir:    child.IsDir,
			FullPath: child.FullPath,
		})
	}
	return &projectFuzzyTreeMatchDTO{Path: match.Path, Children: children}
}

func projectSearchToDTO(repoID string, taskID string, result host.SearchResult) projectSearchDTO {
	matches := make([]projectSearchMatchDTO, 0, len(result.Matches))
	for _, match := range result.Matches {
		matches = append(matches, projectSearchMatchDTO{
			Path:       match.Path,
			Line:       match.Line,
			Content:    match.Content,
			MatchStart: match.MatchStart,
			MatchEnd:   match.MatchEnd,
		})
	}
	return projectSearchDTO{RepoID: repoID, TaskID: taskID, Matches: matches, Truncated: result.Truncated}
}

func projectGitBranchesDTOs(branches []host.GitBranch) []projectGitBranchDTO {
	result := make([]projectGitBranchDTO, 0, len(branches))
	for _, branch := range branches {
		result = append(result, projectGitBranchDTO{
			Name:      branch.Name,
			IsDefault: branch.IsDefault,
			IsRemote:  branch.IsRemote,
		})
	}
	return result
}

func taskGitScopesDTOs(branches []host.GitBranch, worktrees []host.GitWorktree) []taskGitScopeDTO {
	result := []taskGitScopeDTO{taskGitBranchScopeDTO{
		ID:        "branch:HEAD",
		Type:      "branch",
		Name:      "HEAD",
		Ref:       "HEAD",
		IsDefault: false,
		IsRemote:  false,
	}}
	for _, branch := range branches {
		result = append(result, taskGitBranchScopeDTO{
			ID:        "branch:" + branch.Name,
			Type:      "branch",
			Name:      branch.Name,
			Ref:       branch.Name,
			IsDefault: branch.IsDefault,
			IsRemote:  branch.IsRemote,
		})
	}
	for _, worktree := range worktrees {
		result = append(result, taskGitWorktreeScopeDTO{
			ID:         "worktree:" + worktree.WorktreeID,
			Type:       "worktree",
			WorktreeID: worktree.WorktreeID,
			Branch:     worktree.Branch,
			Head:       worktree.Head,
			Label:      worktree.Label,
		})
	}
	return result
}

func projectGitSummaryToDTO(repoID string, summary host.GitSummary) projectGitSummaryDTO {
	return projectGitSummaryDTO{
		RepoID:     repoID,
		Branch:     summary.Branch,
		HeadCommit: summary.HeadCommit,
		Ahead:      summary.Ahead,
		HasChanges: summary.HasChanges,
		Staged:     gitChangeGroupToDTO(summary.Staged),
		Unstaged:   gitChangeGroupToDTO(summary.Unstaged),
		Untracked:  gitChangedFilesToDTO(summary.Untracked),
	}
}

func taskGitSummaryToDTO(repoID string, taskID string, summary host.GitSummary) taskGitSummaryDTO {
	return taskGitSummaryDTO{
		RepoID:     repoID,
		TaskID:     taskID,
		Branch:     summary.Branch,
		HeadCommit: summary.HeadCommit,
		Ahead:      summary.Ahead,
		HasChanges: summary.HasChanges,
		Staged:     gitChangeGroupToDTO(summary.Staged),
		Unstaged:   gitChangeGroupToDTO(summary.Unstaged),
		Untracked:  gitChangedFilesToDTO(summary.Untracked),
	}
}

func taskGitLogToDTO(repoID string, taskID string, result host.GitLogResult) taskGitLogDTO {
	commits := make([]taskGitLogEntryDTO, 0, len(result.Commits))
	for _, commit := range result.Commits {
		commits = append(commits, taskGitLogEntryDTO{
			SHA:          commit.SHA,
			ShortSHA:     commit.ShortSHA,
			Message:      commit.Message,
			Author:       commit.Author,
			Date:         commit.Date,
			RelativeDate: commit.RelativeDate,
			ParentCount:  commit.ParentCount,
		})
	}
	return taskGitLogDTO{
		RepoID:  repoID,
		TaskID:  taskID,
		Commits: commits,
		HasMore: result.HasMore,
	}
}

func taskDiffToDTO(repoID string, taskID string, filePath string, oldPath string, fromTreeish string, result host.GitCommitFilePatchResult) taskDiffDTO {
	return taskDiffDTO{
		RepoID:      repoID,
		TaskID:      taskID,
		FilePath:    filePath,
		OldPath:     oldPath,
		FromTreeish: fromTreeish,
		ToTreeish:   "",
		Patch:       result.Patch,
		Truncated:   result.Truncated,
		Heavy:       result.Heavy,
		Stats: gitPatchStatsDTO{
			Insertions:   result.Stats.Insertions,
			Deletions:    result.Stats.Deletions,
			ChangedLines: result.Stats.ChangedLines,
			HunkCount:    result.Stats.HunkCount,
		},
	}
}

func taskGitCommitFilePatchToDTO(repoID string, taskID string, commit string, filePath string, oldPath string, result host.GitCommitFilePatchResult) taskGitCommitFilePatchDTO {
	return taskGitCommitFilePatchDTO{
		RepoID:    repoID,
		TaskID:    taskID,
		Commit:    commit,
		FilePath:  filePath,
		OldPath:   oldPath,
		Patch:     result.Patch,
		Truncated: result.Truncated,
		Heavy:     result.Heavy,
		Stats: gitPatchStatsDTO{
			Insertions:   result.Stats.Insertions,
			Deletions:    result.Stats.Deletions,
			ChangedLines: result.Stats.ChangedLines,
			HunkCount:    result.Stats.HunkCount,
		},
	}
}

func taskGitCommitToDTO(repoID string, taskID string, result host.GitCommitResult) taskGitCommitDTO {
	return taskGitCommitDTO{
		RepoID:    repoID,
		TaskID:    taskID,
		Committed: result.Committed,
		Status:    result.Status,
		SHA:       result.SHA,
		Error:     result.Error,
	}
}

func projectProcessListToDTO(repoID string, taskID string, result host.ProcessListResult) projectProcessListDTO {
	return projectProcessListDTO{
		RepoID:       repoID,
		TaskID:       taskID,
		SearchRoot:   result.SearchRoot,
		RepoRoot:     result.RepoRoot,
		IsWorktree:   result.IsWorktree,
		WorktreeRoot: result.WorktreeRoot,
		Configs:      procsConfigsToDTO(result.Configs),
		Processes:    processDefinitionsToDTO(result.Processes),
		Errors:       processConfigErrorsToDTO(result.Errors),
		Instances:    []projectProcessInstanceDTO{},
	}
}

func procsConfigsToDTO(configs []host.ProcsConfig) []procsConfigDTO {
	result := make([]procsConfigDTO, 0, len(configs))
	for _, config := range configs {
		result = append(result, procsConfigDTO{
			RelativePath: config.RelativePath,
			Processes:    procsProcessDefsToDTO(config.Processes),
			Crons:        procsCronDefsToDTO(config.Crons),
		})
	}
	return result
}

func procsProcessDefsToDTO(processes []host.ProcsProcessDef) []procsProcessDefDTO {
	result := make([]procsProcessDefDTO, 0, len(processes))
	for _, process := range processes {
		result = append(result, procsProcessDefToDTO(process))
	}
	return result
}

func procsProcessDefToDTO(process host.ProcsProcessDef) procsProcessDefDTO {
	return procsProcessDefDTO{
		ID:      process.ID,
		Name:    process.Name,
		Command: process.Command,
		WorkDir: process.WorkDir,
		URL:     process.URL,
		Type:    process.Type,
	}
}

func procsCronDefsToDTO(crons []host.ProcsCronDef) []procsCronDefDTO {
	result := make([]procsCronDefDTO, 0, len(crons))
	for _, cron := range crons {
		result = append(result, procsCronDefDTO{
			ID:                 cron.ID,
			Name:               cron.Name,
			Schedule:           cron.Schedule,
			Type:               cron.Type,
			Prompt:             cron.Prompt,
			AppendSystemPrompt: cron.AppendSystemPrompt,
			Images:             cron.Images,
			Isolation:          cron.Isolation,
			Harness:            cron.Harness,
			InTaskID:           cron.InTaskID,
			ReuseTask:          cron.ReuseTask,
		})
	}
	return result
}

func processDefinitionsToDTO(processes []host.ProcessDefinition) []projectProcessDefinitionDTO {
	result := make([]projectProcessDefinitionDTO, 0, len(processes))
	for _, process := range processes {
		definition := procsProcessDefToDTO(process.ProcsProcessDef)
		result = append(result, projectProcessDefinitionDTO{
			ID:         definition.ID,
			Name:       definition.Name,
			Command:    definition.Command,
			WorkDir:    definition.WorkDir,
			URL:        definition.URL,
			Type:       definition.Type,
			ConfigPath: process.ConfigPath,
			Cwd:        process.Cwd,
		})
	}
	return result
}

func processConfigErrorsToDTO(errors []host.ProcessConfigError) []procsConfigErrorDTO {
	result := make([]procsConfigErrorDTO, 0, len(errors))
	for _, configError := range errors {
		result = append(result, procsConfigErrorDTO{
			RelativePath: configError.RelativePath,
			Error:        configError.Error,
			Line:         configError.Line,
		})
	}
	return result
}

func emptyProjectGitSummaryDTO(repoID string) projectGitSummaryDTO {
	return projectGitSummaryDTO{
		RepoID:     repoID,
		Branch:     nil,
		HeadCommit: "",
		Ahead:      nil,
		HasChanges: false,
		Staged:     gitChangeGroupDTO{Files: []gitChangedFileDTO{}, Stats: gitChangeStatsDTO{}},
		Unstaged:   gitChangeGroupDTO{Files: []gitChangedFileDTO{}, Stats: gitChangeStatsDTO{}},
		Untracked:  []gitChangedFileDTO{},
	}
}

func emptyTaskGitSummaryDTO(repoID string, taskID string) taskGitSummaryDTO {
	return taskGitSummaryDTO{
		RepoID:     repoID,
		TaskID:     taskID,
		Branch:     nil,
		HeadCommit: "",
		Ahead:      nil,
		HasChanges: false,
		Staged:     gitChangeGroupDTO{Files: []gitChangedFileDTO{}, Stats: gitChangeStatsDTO{}},
		Unstaged:   gitChangeGroupDTO{Files: []gitChangedFileDTO{}, Stats: gitChangeStatsDTO{}},
		Untracked:  []gitChangedFileDTO{},
	}
}

func gitChangeGroupToDTO(group host.GitChangeGroup) gitChangeGroupDTO {
	return gitChangeGroupDTO{
		Files: gitChangedFilesToDTO(group.Files),
		Stats: gitChangeStatsDTO{
			FilesChanged: group.Stats.FilesChanged,
			Insertions:   group.Stats.Insertions,
			Deletions:    group.Stats.Deletions,
		},
	}
}

func gitChangedFilesToDTO(files []host.GitChangedFile) []gitChangedFileDTO {
	result := make([]gitChangedFileDTO, 0, len(files))
	for _, file := range files {
		result = append(result, gitChangedFileDTO{
			Path:    file.Path,
			Status:  file.Status,
			OldPath: file.OldPath,
			Binary:  file.Binary,
		})
	}
	return result
}

func taskToDTO(task storage.Task, events []storage.TaskEvent, comments []storage.Comment, deviceEnvironments []storage.TaskDeviceEnvironment, queuedTurns []storage.QueuedTurn) taskDTO {
	metadata := taskMetadataFromTask(task)
	return taskDTO{
		ID:                   task.ID,
		RepoID:               task.RepoID,
		Slug:                 task.Slug,
		Title:                task.Title,
		Description:          task.Description,
		IsolationStrategy:    decodeNullableRawJSON(task.IsolationJSON),
		EnabledMCPServerIDs:  metadata.EnabledMCPServerIDs,
		SessionIDs:           metadata.SessionIDs,
		CancelledPlanEventID: metadata.CancelledPlanEventID,
		DeviceEnvironments:   deviceEnvironmentsToDTO(deviceEnvironments),
		CreatedBy:            validUserPointer(metadata.CreatedBy),
		CreatedAt:            formatTime(task.CreatedAt),
		UpdatedAt:            formatTime(task.UpdatedAt),
		LastViewedAt:         formatNullTime(task.LastViewedAt),
		LastEventAt:          formatNullTime(task.LastEventAt),
		Closed:               task.Closed,
		Events:               taskEventsDTO(events),
		Comments:             commentsDTO(comments),
		QueuedTurns:          queuedTurnsDTO(queuedTurns),
	}
}

func taskMetadataFromTask(task storage.Task) taskCreateMetadataDTO {
	if !task.MetadataJSON.Valid || strings.TrimSpace(task.MetadataJSON.String) == "" {
		return taskCreateMetadataDTO{}
	}
	var metadata taskCreateMetadataDTO
	if err := json.Unmarshal([]byte(task.MetadataJSON.String), &metadata); err != nil {
		return taskCreateMetadataDTO{}
	}
	metadata.CreatedBy.ID = strings.TrimSpace(metadata.CreatedBy.ID)
	metadata.CreatedBy.Email = strings.TrimSpace(metadata.CreatedBy.Email)
	metadata.EnabledMCPServerIDs = nonEmptyStringSlice(metadata.EnabledMCPServerIDs)
	metadata.SessionIDs = nonEmptyStringMap(metadata.SessionIDs)
	metadata.CancelledPlanEventID = strings.TrimSpace(metadata.CancelledPlanEventID)
	return metadata
}

func validUserPointer(user userDTO) *userDTO {
	user.ID = strings.TrimSpace(user.ID)
	user.Email = strings.TrimSpace(user.Email)
	if user.ID == "" || user.Email == "" {
		return nil
	}
	return &user
}

func nonEmptyStringSlice(value []string) []string {
	result := []string{}
	for _, item := range value {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func nonEmptyStringMap(value map[string]string) map[string]string {
	result := map[string]string{}
	for key, nested := range value {
		trimmedKey := strings.TrimSpace(key)
		trimmedNested := strings.TrimSpace(nested)
		if trimmedKey != "" && trimmedNested != "" {
			result[trimmedKey] = trimmedNested
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func deviceEnvironmentsToDTO(environments []storage.TaskDeviceEnvironment) []deviceEnvironmentDTO {
	result := make([]deviceEnvironmentDTO, 0, len(environments))
	for _, environment := range environments {
		result = append(result, deviceEnvironmentToDTO(environment))
	}
	return result
}

func deviceEnvironmentToDTO(environment storage.TaskDeviceEnvironment) deviceEnvironmentDTO {
	return deviceEnvironmentDTO{
		ID:              environment.ID,
		DeviceID:        environment.DeviceID,
		WorktreeDir:     nullStringValue(environment.WorktreeDir),
		SetupComplete:   environment.SetupComplete,
		MergeBaseCommit: nullStringValue(environment.MergeBaseCommit),
		CreatedAt:       formatTime(environment.CreatedAt),
		LastUsedAt:      formatTime(environment.LastUsedAt),
	}
}

func taskResourceInventoryToDTO(task storage.Task, events []storage.TaskEvent, isRunning bool, branchMerged *bool) taskResourceInventoryDTO {
	snapshotIDs := []string{}
	seenSnapshots := map[string]bool{}
	images := []taskResourceImageDTO{}
	seenImages := map[string]bool{}
	sessions := []taskResourceSessionDTO{}
	seenSessions := map[string]bool{}

	addSnapshot := func(id string) {
		if id == "" || seenSnapshots[id] {
			return
		}
		seenSnapshots[id] = true
		snapshotIDs = append(snapshotIDs, id)
	}
	addImage := func(image taskResourceImageDTO) {
		if image.ID == "" || image.Ext == "" {
			return
		}
		key := image.ID + "." + image.Ext
		if seenImages[key] {
			return
		}
		seenImages[key] = true
		images = append(images, image)
	}
	addSession := func(sessionID string, harnessID string) {
		if sessionID == "" || seenSessions[sessionID] {
			return
		}
		if harnessID == "" {
			harnessID = "claude-code"
		}
		seenSessions[sessionID] = true
		sessions = append(sessions, taskResourceSessionDTO{SessionID: sessionID, HarnessID: harnessID})
	}

	for _, event := range events {
		payload, ok := taskResourcePayload(event)
		eventType := event.Type
		if ok && payload.Type != "" {
			eventType = payload.Type
		}
		if eventType == "snapshot" && ok {
			addSnapshot(payload.PatchFileID)
		}
		if eventType != "action" || !ok {
			continue
		}
		for _, image := range taskResourceImages(payload.Images) {
			addImage(image)
		}
		eventExecution := taskResourceExecution(payload.Execution)
		addSession(eventExecution.SessionID, eventExecution.HarnessID)
		for _, subExecutionRaw := range payload.HyperPlanSubExecutions {
			subExecution := taskResourceExecution(subExecutionRaw)
			if subExecution.HarnessID == "" {
				subExecution.HarnessID = eventExecution.HarnessID
			}
			addSession(subExecution.SessionID, subExecution.HarnessID)
		}
	}

	for _, sessionID := range taskResourceMetadataSessionIDs(task) {
		addSession(sessionID, "claude-code")
	}

	return taskResourceInventoryDTO{
		RepoID:      task.RepoID,
		TaskID:      task.ID,
		TaskTitle:   taskResourceInventoryTitle(task),
		IsRunning:   isRunning,
		SnapshotIDs: snapshotIDs,
		Images:      images,
		Sessions:    sessions,
		Worktree:    taskResourceWorktree(task, branchMerged),
	}
}

func taskImageReference(events []storage.TaskEvent, queuedTurns []storage.QueuedTurn, imageID string, ext string) *taskImageReferenceDTO {
	for _, event := range events {
		payload, ok := taskResourcePayload(event)
		eventType := event.Type
		if ok && payload.Type != "" {
			eventType = payload.Type
		}
		if eventType != "action" || !ok {
			continue
		}
		for _, image := range taskImageReferences(payload.Images) {
			if image.ID == imageID && image.Ext == ext {
				return &image
			}
		}
	}
	for _, turn := range queuedTurns {
		for _, image := range taskImageReferencesFromQueuedTurn(turn) {
			if image.ID == imageID && image.Ext == ext {
				return &image
			}
		}
	}
	return nil
}

func (service *Service) referencedTaskImages(ctx context.Context) ([]taskImageReferenceDTO, int, *core.RuntimeError) {
	taskIDs, err := service.store.ListTaskIDs(ctx)
	if err != nil {
		return nil, 0, handlerError(err)
	}
	refs := []taskImageReferenceDTO{}
	seen := map[string]bool{}
	addRef := func(image taskImageReferenceDTO) {
		if image.ID == "" || image.Ext == "" {
			return
		}
		key := image.ID + "." + image.Ext
		if seen[key] {
			return
		}
		seen[key] = true
		refs = append(refs, image)
	}

	for _, taskID := range taskIDs {
		events, err := service.store.ListTaskEvents(ctx, taskID, true)
		if err != nil {
			return nil, 0, handlerError(err)
		}
		for _, event := range events {
			payload, ok := taskResourcePayload(event)
			eventType := event.Type
			if ok && payload.Type != "" {
				eventType = payload.Type
			}
			if eventType != "action" || !ok {
				continue
			}
			for _, image := range taskImageReferences(payload.Images) {
				addRef(image)
			}
		}
		queuedTurns, err := service.store.ListQueuedTurns(ctx, taskID)
		if err != nil {
			return nil, 0, handlerError(err)
		}
		for _, turn := range queuedTurns {
			for _, image := range taskImageReferencesFromQueuedTurn(turn) {
				addRef(image)
			}
		}
	}

	return refs, len(taskIDs), nil
}

func (service *Service) referencedHarnessSessions(ctx context.Context) ([]taskHarnessSessionReference, int, *core.RuntimeError) {
	taskIDs, err := service.store.ListTaskIDs(ctx)
	if err != nil {
		return nil, 0, handlerError(err)
	}
	refsByKey := map[string]*taskHarnessSessionReference{}
	orderedKeys := []string{}
	addRef := func(session taskResourceSessionDTO, cwd string) {
		if session.SessionID == "" || session.HarnessID == "" {
			return
		}
		key := harnessSessionBlobID(session.HarnessID, session.SessionID)
		ref := refsByKey[key]
		if ref == nil {
			ref = &taskHarnessSessionReference{
				SessionID: session.SessionID,
				HarnessID: session.HarnessID,
				CWDs:      []string{},
			}
			refsByKey[key] = ref
			orderedKeys = append(orderedKeys, key)
		}
		if cwd == "" || stringSliceContains(ref.CWDs, cwd) {
			return
		}
		ref.CWDs = append(ref.CWDs, cwd)
	}

	for _, taskID := range taskIDs {
		task, ok, err := service.store.GetTask(ctx, taskID)
		if err != nil {
			return nil, 0, handlerError(err)
		}
		if !ok {
			continue
		}
		repo, ok, err := service.store.GetRepo(ctx, task.RepoID)
		if err != nil {
			return nil, 0, handlerError(err)
		}
		if !ok {
			continue
		}
		events, err := service.store.ListTaskEvents(ctx, taskID, true)
		if err != nil {
			return nil, 0, handlerError(err)
		}
		inventory := taskResourceInventoryToDTO(task, events, false, nil)
		for _, session := range inventory.Sessions {
			addRef(session, repo.Path)
		}
	}

	refs := make([]taskHarnessSessionReference, 0, len(orderedKeys))
	for _, key := range orderedKeys {
		refs = append(refs, *refsByKey[key])
	}
	return refs, len(taskIDs), nil
}

func taskImageReferences(rawImages []json.RawMessage) []taskImageReferenceDTO {
	images := make([]taskImageReferenceDTO, 0, len(rawImages))
	for _, rawImage := range rawImages {
		var image taskImageReferenceDTO
		if err := json.Unmarshal(rawImage, &image); err != nil {
			continue
		}
		image.Ext = strings.ToLower(image.Ext)
		if image.MediaType != "" && !strings.HasPrefix(image.MediaType, "image/") {
			image.MediaType = ""
		}
		if validateTaskImageID(image.ID) != nil || validateTaskImageExt(image.Ext) != nil {
			continue
		}
		images = append(images, image)
	}
	return images
}

func taskImageReferencesFromQueuedTurn(turn storage.QueuedTurn) []taskImageReferenceDTO {
	if !turn.PayloadJSON.Valid || strings.TrimSpace(turn.PayloadJSON.String) == "" {
		return []taskImageReferenceDTO{}
	}
	var payload struct {
		Images []json.RawMessage `json:"images"`
	}
	if err := json.Unmarshal([]byte(turn.PayloadJSON.String), &payload); err != nil {
		return []taskImageReferenceDTO{}
	}
	return taskImageReferences(payload.Images)
}

func emptyTaskImageReadDTO(repoID string, taskID string, imageID string, ext string) taskImageReadDTO {
	return taskImageReadDTO{RepoID: repoID, TaskID: taskID, ImageID: imageID, Ext: ext, Data: nil}
}

const maxTaskImageBlobBytes = 20 * 1024 * 1024
const defaultStagedTaskImageGCAge = 24 * time.Hour
const maxHarnessSessionBlobBytes = 128 * 1024 * 1024
const harnessSessionContentType = "application/x-ndjson"

func readLegacyTaskImageFile(sourcePath string) ([]byte, string) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "missing"
		}
		return nil, "inspect_failed"
	}
	if !info.Mode().IsRegular() {
		return nil, "not_regular"
	}
	if info.Size() == 0 {
		return nil, "empty"
	}
	if info.Size() > maxTaskImageBlobBytes {
		return nil, "too_large"
	}
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, "read_failed"
	}
	if len(data) == 0 {
		return nil, "empty"
	}
	if len(data) > maxTaskImageBlobBytes {
		return nil, "too_large"
	}
	return data, ""
}

func validateLegacyHarnessSessionRoots(roots host.HarnessSessionRoots) *core.RuntimeError {
	if strings.TrimSpace(roots.ClaudeConfigDir) != "" {
		if runtimeErr := requireLegacyResourceDir("claudeConfigDir", roots.ClaudeConfigDir, "failed to inspect legacy Claude config directory"); runtimeErr != nil {
			return runtimeErr
		}
	}
	if strings.TrimSpace(roots.CodexHome) != "" {
		if runtimeErr := requireLegacyResourceDir("codexHome", roots.CodexHome, "failed to inspect legacy Codex home directory"); runtimeErr != nil {
			return runtimeErr
		}
	}
	return nil
}

func readLegacyHarnessSessionData(ref taskHarnessSessionReference, roots host.HarnessSessionRoots) ([]byte, string) {
	if ref.HarnessID != "claude-code" && ref.HarnessID != "codex" {
		return nil, "unsupported_harness"
	}
	cwds := ref.CWDs
	if len(cwds) == 0 {
		cwds = []string{""}
	}
	for _, cwd := range cwds {
		sourcePath, found, err := host.FindHarnessSessionFile(ref.HarnessID, ref.SessionID, cwd, roots)
		if err != nil {
			return nil, "find_failed"
		}
		if !found {
			continue
		}
		return readLegacyHarnessSessionFile(sourcePath)
	}
	return nil, "missing"
}

func readLegacyHarnessSessionFile(sourcePath string) ([]byte, string) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "missing"
		}
		return nil, "inspect_failed"
	}
	if !info.Mode().IsRegular() {
		return nil, "not_regular"
	}
	if info.Size() == 0 {
		return nil, "empty"
	}
	if info.Size() > maxHarnessSessionBlobBytes {
		return nil, "too_large"
	}
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, "read_failed"
	}
	if len(data) == 0 {
		return nil, "empty"
	}
	if len(data) > maxHarnessSessionBlobBytes {
		return nil, "too_large"
	}
	return data, ""
}

func (service *Service) writeHarnessSessionBlob(ctx context.Context, ref taskHarnessSessionReference, data []byte, createdAt time.Time) *core.RuntimeError {
	if ref.HarnessID != "claude-code" && ref.HarnessID != "codex" {
		return invalidParams("harnessId is unsupported")
	}
	blobDir := strings.TrimSpace(service.options.BlobDir)
	if blobDir == "" {
		return handlerError(errorString("blob directory is not configured"))
	}
	blobID := harnessSessionBlobID(ref.HarnessID, ref.SessionID)
	hash := sha256.Sum256(data)
	hashString := hex.EncodeToString(hash[:])
	existing, ok, err := service.store.GetBlobMetadata(ctx, blobID)
	if err != nil {
		return handlerError(err)
	}
	if ok {
		if existing.Kind != "harness_session" {
			return &core.RuntimeError{Code: "conflict", Message: "Harness session id conflicts with an existing blob"}
		}
		if existing.SHA256 != hashString || existing.SizeBytes != int64(len(data)) || existing.ContentType.String != harnessSessionContentType {
			return &core.RuntimeError{Code: "conflict", Message: "Harness session already exists with different content"}
		}
		if _, err := os.Stat(existing.Path); err == nil {
			return nil
		} else if err != nil && !os.IsNotExist(err) {
			return handlerError(errorString("failed to inspect harness session blob"))
		}
	}

	sessionDir := filepath.Join(blobDir, "sessions", ref.HarnessID)
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return handlerError(errorString("failed to create harness session blob directory"))
	}
	targetPath := filepath.Join(sessionDir, ref.SessionID+".jsonl")
	tempPath := targetPath + ".tmp-" + randomHexID()
	if err := os.WriteFile(tempPath, data, 0o600); err != nil {
		return handlerError(errorString("failed to write harness session blob"))
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
		return handlerError(errorString("failed to finalize harness session blob"))
	}
	if err := service.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          blobID,
		Kind:        "harness_session",
		ContentType: sql.NullString{String: harnessSessionContentType, Valid: true},
		SizeBytes:   int64(len(data)),
		SHA256:      hashString,
		Path:        targetPath,
		CreatedAt:   createdAt,
	}); err != nil {
		_ = os.Remove(targetPath)
		return handlerError(err)
	}
	return nil
}

func harnessSessionBlobID(harnessID string, sessionID string) string {
	return "harness_session:" + harnessID + ":" + sessionID
}

func taskHarnessSessionIssue(ref taskHarnessSessionReference, code string) taskHarnessSessionImportLegacyIssueDTO {
	return taskHarnessSessionImportLegacyIssueDTO{
		SessionID: ref.SessionID,
		HarnessID: ref.HarnessID,
		Code:      code,
	}
}

func taskImageIssueForBlob(blob storage.BlobMetadata, code string) taskImageImportLegacyIssueDTO {
	return taskImageImportLegacyIssueDTO{
		ImageID: blob.ID,
		Ext:     taskImageExtFromBlob(blob),
		Code:    code,
	}
}

func taskImageExtFromBlob(blob storage.BlobMetadata) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(blob.Path)), ".")
	if validateTaskImageExt(ext) == nil {
		return ext
	}
	switch blob.ContentType.String {
	case "image/gif":
		return "gif"
	case "image/jpeg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	default:
		return ""
	}
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

type taskImageBlobWriteInput struct {
	ImageID   string
	Ext       string
	MediaType string
	Data      []byte
	CreatedAt time.Time
}

func (service *Service) writeTaskImageBlob(ctx context.Context, input taskImageBlobWriteInput) (taskImageWriteDTO, *core.RuntimeError) {
	blobDir := strings.TrimSpace(service.options.BlobDir)
	if blobDir == "" {
		return taskImageWriteDTO{}, handlerError(errorString("blob directory is not configured"))
	}
	hash := sha256.Sum256(input.Data)
	hashString := hex.EncodeToString(hash[:])
	existing, ok, err := service.store.GetBlobMetadata(ctx, input.ImageID)
	if err != nil {
		return taskImageWriteDTO{}, handlerError(err)
	}
	if ok {
		if existing.Kind != "task_image" {
			return taskImageWriteDTO{}, &core.RuntimeError{Code: "conflict", Message: "Image id conflicts with an existing blob"}
		}
		if existing.SHA256 != hashString || existing.SizeBytes != int64(len(input.Data)) || existing.ContentType.String != input.MediaType {
			return taskImageWriteDTO{}, &core.RuntimeError{Code: "conflict", Message: "Image id already exists with different content"}
		}
		if _, err := os.Stat(existing.Path); err == nil {
			return taskImageWriteDTO{
				ImageID:   input.ImageID,
				Ext:       input.Ext,
				MediaType: input.MediaType,
				Size:      existing.SizeBytes,
				SHA256:    existing.SHA256,
			}, nil
		} else if err != nil && !os.IsNotExist(err) {
			return taskImageWriteDTO{}, handlerError(errorString("failed to inspect task image blob"))
		}
	}

	imageDir := filepath.Join(blobDir, "images")
	if err := os.MkdirAll(imageDir, 0o755); err != nil {
		return taskImageWriteDTO{}, handlerError(errorString("failed to create task image blob directory"))
	}
	targetPath := filepath.Join(imageDir, input.ImageID+"."+input.Ext)
	tempPath := targetPath + ".tmp-" + randomHexID()
	if err := os.WriteFile(tempPath, input.Data, 0o600); err != nil {
		return taskImageWriteDTO{}, handlerError(errorString("failed to write task image blob"))
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
		return taskImageWriteDTO{}, handlerError(errorString("failed to finalize task image blob"))
	}
	if err := service.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          input.ImageID,
		Kind:        "task_image",
		ContentType: sql.NullString{String: input.MediaType, Valid: true},
		SizeBytes:   int64(len(input.Data)),
		SHA256:      hashString,
		Path:        targetPath,
		CreatedAt:   input.CreatedAt,
	}); err != nil {
		_ = os.Remove(targetPath)
		return taskImageWriteDTO{}, handlerError(err)
	}
	return taskImageWriteDTO{
		ImageID:   input.ImageID,
		Ext:       input.Ext,
		MediaType: input.MediaType,
		Size:      int64(len(input.Data)),
		SHA256:    hashString,
	}, nil
}

func validateTaskImageID(value string) error {
	if value == "" {
		return errorString("imageId is required")
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return errorString("imageId is invalid")
	}
	return nil
}

func validateTaskImageExt(value string) error {
	switch value {
	case "gif", "jpeg", "jpg", "png", "webp":
		return nil
	case "":
		return errorString("ext is required")
	default:
		return errorString("ext is invalid")
	}
}

func validateTaskImageMediaType(ext string, mediaType string) error {
	if mediaType == "" {
		return errorString("mediaType is required")
	}
	if mediaType == taskImageMediaTypeForExt(ext) {
		return nil
	}
	return errorString("mediaType does not match ext")
}

func taskImageMediaTypeForExt(ext string) string {
	switch ext {
	case "gif":
		return "image/gif"
	case "jpeg", "jpg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	default:
		return ""
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func requireLegacyResourceDir(field string, sourceDir string, inspectMessage string) *core.RuntimeError {
	exists, runtimeErr := inspectLegacyResourceDir(field, sourceDir, inspectMessage)
	if runtimeErr != nil {
		return runtimeErr
	}
	if !exists {
		return invalidParams(field + " does not exist")
	}
	return nil
}

func inspectLegacyResourceDir(field string, sourceDir string, inspectMessage string) (bool, *core.RuntimeError) {
	sourceInfo, err := os.Stat(sourceDir)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, handlerError(errorString(inspectMessage))
	}
	if !sourceInfo.IsDir() {
		return false, invalidParams(field + " must be a directory")
	}
	return true, nil
}

func (service *Service) taskSnapshotEvent(ctx context.Context, repoID string, taskID string, eventID string) (taskResourceEventPayload, *core.RuntimeError) {
	if repoID == "" {
		return taskResourceEventPayload{}, invalidParams("repoId is required")
	}
	if taskID == "" {
		return taskResourceEventPayload{}, invalidParams("taskId is required")
	}
	if eventID == "" {
		return taskResourceEventPayload{}, invalidParams("eventId is required")
	}
	task, ok, err := service.store.GetTask(ctx, taskID)
	if err != nil {
		return taskResourceEventPayload{}, handlerError(err)
	}
	if !ok || task.RepoID != repoID {
		return taskResourceEventPayload{}, &core.RuntimeError{Code: "not_found", Message: "Task not found"}
	}
	events, err := service.store.ListTaskEvents(ctx, taskID, true)
	if err != nil {
		return taskResourceEventPayload{}, handlerError(err)
	}
	for _, event := range events {
		payload, ok := taskResourcePayload(event)
		eventType := event.Type
		if ok && payload.Type != "" {
			eventType = payload.Type
		}
		payloadID := event.ID
		if ok && payload.ID != "" {
			payloadID = payload.ID
		}
		if eventType == "snapshot" && payloadID == eventID {
			payload.ID = payloadID
			payload.Type = "snapshot"
			if payload.PatchFileID != "" {
				if err := validateSnapshotPatchFileID(payload.PatchFileID); err != nil {
					return taskResourceEventPayload{}, invalidParams(err.Error())
				}
			}
			return payload, nil
		}
	}
	return taskResourceEventPayload{}, &core.RuntimeError{Code: "not_found", Message: "Snapshot event not found"}
}

func (service *Service) taskSnapshotPatch(ctx context.Context, snapshot taskResourceEventPayload) (*string, *core.RuntimeError) {
	if snapshot.FullPatch != "" {
		return &snapshot.FullPatch, nil
	}
	if snapshot.PatchFileID == "" {
		return nil, nil
	}
	blob, ok, err := service.store.GetBlobMetadata(ctx, snapshot.PatchFileID)
	if err != nil {
		return nil, handlerError(err)
	}
	if !ok || blob.Kind != "snapshot_patch" {
		return nil, nil
	}
	data, err := os.ReadFile(blob.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, handlerError(errorString("failed to read snapshot patch blob"))
	}
	patch := string(data)
	return &patch, nil
}

type snapshotEventPayloadInput struct {
	EventID         string
	CreatedAt       time.Time
	ActionEventID   string
	ReferenceBranch string
	MergeBaseCommit string
	FullPatch       string
	PatchFileID     string
	Stats           snapshotStatsDTO
	Files           []snapshotChangedFileDTO
}

func snapshotEventPayloadJSON(input snapshotEventPayloadInput) (json.RawMessage, *core.RuntimeError) {
	payload := struct {
		ID              string                   `json:"id"`
		Type            string                   `json:"type"`
		Status          string                   `json:"status"`
		CreatedAt       string                   `json:"createdAt"`
		CompletedAt     string                   `json:"completedAt"`
		UserInput       string                   `json:"userInput"`
		ActionEventID   string                   `json:"actionEventId"`
		ReferenceBranch string                   `json:"referenceBranch"`
		MergeBaseCommit string                   `json:"mergeBaseCommit"`
		FullPatch       string                   `json:"fullPatch"`
		PatchFileID     string                   `json:"patchFileId,omitempty"`
		Stats           snapshotStatsDTO         `json:"stats"`
		Files           []snapshotChangedFileDTO `json:"files,omitempty"`
	}{
		ID:              input.EventID,
		Type:            "snapshot",
		Status:          "completed",
		CreatedAt:       formatTime(input.CreatedAt),
		CompletedAt:     formatTime(input.CreatedAt),
		UserInput:       "",
		ActionEventID:   input.ActionEventID,
		ReferenceBranch: input.ReferenceBranch,
		MergeBaseCommit: input.MergeBaseCommit,
		FullPatch:       input.FullPatch,
		PatchFileID:     input.PatchFileID,
		Stats:           input.Stats,
		Files:           input.Files,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, handlerError(err)
	}
	return json.RawMessage(data), nil
}

func (service *Service) writeSnapshotPatchBlob(ctx context.Context, patchFileID string, patch string, createdAt time.Time) *core.RuntimeError {
	if err := validateSnapshotPatchFileID(patchFileID); err != nil {
		return invalidParams(err.Error())
	}
	blobDir := strings.TrimSpace(service.options.BlobDir)
	if blobDir == "" {
		return handlerError(errorString("blob directory is not configured"))
	}
	data := []byte(patch)
	snapshotDir := filepath.Join(blobDir, "snapshots")
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return handlerError(errorString("failed to create snapshot blob directory"))
	}
	targetPath := filepath.Join(snapshotDir, patchFileID+".patch")
	tempPath := targetPath + ".tmp-" + randomHexID()
	if err := os.WriteFile(tempPath, data, 0o600); err != nil {
		return handlerError(errorString("failed to write snapshot patch blob"))
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
		return handlerError(errorString("failed to finalize snapshot patch blob"))
	}
	hash := sha256.Sum256(data)
	if err := service.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          patchFileID,
		Kind:        "snapshot_patch",
		ContentType: sql.NullString{String: "text/x-patch", Valid: true},
		SizeBytes:   int64(len(data)),
		SHA256:      hex.EncodeToString(hash[:]),
		Path:        targetPath,
		CreatedAt:   createdAt,
	}); err != nil {
		_ = os.Remove(targetPath)
		return handlerError(err)
	}
	return nil
}

func readLegacySnapshotPatchFile(sourcePath string) ([]byte, string) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "missing"
		}
		return nil, "inspect_failed"
	}
	if !info.Mode().IsRegular() {
		return nil, "not_regular"
	}
	if info.Size() == 0 {
		return nil, "empty"
	}
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, "read_failed"
	}
	if len(data) == 0 {
		return nil, "empty"
	}
	return data, ""
}

func (service *Service) importLegacySnapshotPatchBlob(ctx context.Context, patchFileID string, data []byte, createdAt time.Time) *core.RuntimeError {
	if err := validateSnapshotPatchFileID(patchFileID); err != nil {
		return invalidParams(err.Error())
	}
	blobDir := strings.TrimSpace(service.options.BlobDir)
	if blobDir == "" {
		return handlerError(errorString("blob directory is not configured"))
	}
	hash := sha256.Sum256(data)
	hashString := hex.EncodeToString(hash[:])
	existing, ok, err := service.store.GetBlobMetadata(ctx, patchFileID)
	if err != nil {
		return handlerError(err)
	}
	if ok {
		if existing.Kind != "snapshot_patch" {
			return &core.RuntimeError{Code: "conflict", Message: "Snapshot patch id conflicts with an existing blob"}
		}
		if existing.SHA256 != hashString || existing.SizeBytes != int64(len(data)) || existing.ContentType.String != "text/x-patch" {
			return &core.RuntimeError{Code: "conflict", Message: "Snapshot patch id already exists with different content"}
		}
		if _, err := os.Stat(existing.Path); err == nil {
			return nil
		} else if err != nil && !os.IsNotExist(err) {
			return handlerError(errorString("failed to inspect snapshot patch blob"))
		}
	}

	snapshotDir := filepath.Join(blobDir, "snapshots")
	if err := os.MkdirAll(snapshotDir, 0o755); err != nil {
		return handlerError(errorString("failed to create snapshot blob directory"))
	}
	targetPath := filepath.Join(snapshotDir, patchFileID+".patch")
	tempPath := targetPath + ".tmp-" + randomHexID()
	if err := os.WriteFile(tempPath, data, 0o600); err != nil {
		return handlerError(errorString("failed to write snapshot patch blob"))
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
		return handlerError(errorString("failed to finalize snapshot patch blob"))
	}
	if err := service.store.PutBlobMetadata(ctx, storage.BlobMetadata{
		ID:          patchFileID,
		Kind:        "snapshot_patch",
		ContentType: sql.NullString{String: "text/x-patch", Valid: true},
		SizeBytes:   int64(len(data)),
		SHA256:      hashString,
		Path:        targetPath,
		CreatedAt:   createdAt,
	}); err != nil {
		_ = os.Remove(targetPath)
		return handlerError(err)
	}
	return nil
}

func validateSnapshotPatchFileID(value string) error {
	if value == "" {
		return errorString("snapshot patch file id is required")
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return errorString("snapshot patch file id is invalid")
	}
	return nil
}

func buildSnapshotPatchIndex(patch string) snapshotPatchIndexDTO {
	files := []snapshotPatchFileDTO{}
	if patch == "" {
		return snapshotPatchIndexDTO{Version: 1, PatchSize: 0, Files: files}
	}
	lines := strings.Split(patch, "\n")
	var current *snapshotPatchFileDTO
	byteOffset := 0
	for index, line := range lines {
		lineByteLength := len([]byte(line))
		if index < len(lines)-1 {
			lineByteLength += 1
		}
		if strings.HasPrefix(line, "diff --git ") {
			files = finalizeSnapshotPatchIndexFile(files, current, byteOffset)
			header := parseSnapshotDiffHeader(line)
			current = &snapshotPatchFileDTO{
				ID:         "",
				Path:       header.path,
				OldPath:    header.oldPath,
				Status:     "modified",
				Binary:     false,
				Insertions: 0,
				Deletions:  0,
				HunkCount:  0,
				PatchStart: byteOffset,
			}
		} else if current != nil {
			switch {
			case strings.HasPrefix(line, "rename from "):
				current.OldPath = strings.TrimPrefix(line, "rename from ")
				current.Status = "renamed"
			case strings.HasPrefix(line, "rename to "):
				current.Path = strings.TrimPrefix(line, "rename to ")
				current.Status = "renamed"
			case strings.HasPrefix(line, "new file mode ") || line == "--- /dev/null":
				current.Status = "added"
			case strings.HasPrefix(line, "deleted file mode ") || line == "+++ /dev/null":
				current.Status = "deleted"
			case strings.HasPrefix(line, "--- a/"):
				current.OldPath = strings.TrimPrefix(line, "--- a/")
			case strings.HasPrefix(line, "+++ b/"):
				current.Path = strings.TrimPrefix(line, "+++ b/")
			case strings.HasPrefix(line, "Binary files ") || line == "GIT binary patch":
				current.Binary = true
			case strings.HasPrefix(line, "@@"):
				current.HunkCount += 1
			case strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++"):
				current.Insertions += 1
			case strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---"):
				current.Deletions += 1
			}
		}
		byteOffset += lineByteLength
	}
	files = finalizeSnapshotPatchIndexFile(files, current, byteOffset)
	return snapshotPatchIndexDTO{Version: 1, PatchSize: len([]byte(patch)), Files: files}
}

type snapshotDiffHeader struct {
	oldPath string
	path    string
}

func parseSnapshotDiffHeader(line string) snapshotDiffHeader {
	const prefix = "diff --git a/"
	if !strings.HasPrefix(line, prefix) {
		return snapshotDiffHeader{path: "unknown"}
	}
	rest := strings.TrimPrefix(line, prefix)
	parts := strings.SplitN(rest, " b/", 2)
	if len(parts) != 2 || parts[1] == "" {
		return snapshotDiffHeader{path: "unknown"}
	}
	return snapshotDiffHeader{oldPath: parts[0], path: parts[1]}
}

func finalizeSnapshotPatchIndexFile(files []snapshotPatchFileDTO, current *snapshotPatchFileDTO, patchEnd int) []snapshotPatchFileDTO {
	if current == nil {
		return files
	}
	file := *current
	file.ID = strconv.Itoa(len(files))
	if file.OldPath == file.Path {
		file.OldPath = ""
	}
	file.ChangedLines = file.Insertions + file.Deletions
	file.PatchEnd = patchEnd
	return append(files, file)
}

func sliceSnapshotPatch(patch string, start int, end int) (string, *core.RuntimeError) {
	bytes := []byte(patch)
	if end > len(bytes) {
		return "", invalidParams("patch slice exceeds patch size")
	}
	return string(bytes[start:end]), nil
}

func taskResourcePayload(event storage.TaskEvent) (taskResourceEventPayload, bool) {
	if !event.PayloadJSON.Valid || strings.TrimSpace(event.PayloadJSON.String) == "" {
		return taskResourceEventPayload{}, false
	}
	var payload taskResourceEventPayload
	if err := json.Unmarshal([]byte(event.PayloadJSON.String), &payload); err != nil {
		return taskResourceEventPayload{}, false
	}
	return payload, true
}

func taskResourceImages(rawImages []json.RawMessage) []taskResourceImageDTO {
	images := make([]taskResourceImageDTO, 0, len(rawImages))
	for _, rawImage := range rawImages {
		var image taskResourceImageDTO
		if err := json.Unmarshal(rawImage, &image); err != nil {
			continue
		}
		if image.ID == "" || image.Ext == "" {
			continue
		}
		images = append(images, image)
	}
	return images
}

func taskResourceExecution(rawExecution json.RawMessage) taskResourceExecutionPayload {
	if len(rawExecution) == 0 {
		return taskResourceExecutionPayload{}
	}
	var execution taskResourceExecutionPayload
	if err := json.Unmarshal(rawExecution, &execution); err != nil {
		return taskResourceExecutionPayload{}
	}
	return execution
}

func taskResourceMetadataSessionIDs(task storage.Task) []string {
	metadata := taskMetadataFromTask(task)
	sessions := make([]string, 0, len(metadata.SessionIDs))
	for _, sessionID := range metadata.SessionIDs {
		sessions = append(sessions, sessionID)
	}
	return sessions
}

func taskResourceInventoryTitle(task storage.Task) string {
	if task.Title != "" {
		return task.Title
	}
	if task.Description != "" {
		return task.Description
	}
	return "Untitled"
}

func taskResourceWorktree(task storage.Task, branchMerged *bool) *taskResourceWorktreeDTO {
	sourceBranch := taskResourceWorktreeSourceBranch(task)
	if sourceBranch == "" {
		return nil
	}
	return &taskResourceWorktreeDTO{
		Slug:         task.Slug,
		BranchName:   "openade/" + task.Slug,
		SourceBranch: sourceBranch,
		BranchMerged: branchMerged,
	}
}

func taskResourceWorktreeSourceBranch(task storage.Task) string {
	if !task.IsolationJSON.Valid || strings.TrimSpace(task.IsolationJSON.String) == "" {
		return ""
	}
	var isolation struct {
		Type         string `json:"type"`
		SourceBranch string `json:"sourceBranch"`
	}
	if err := json.Unmarshal([]byte(task.IsolationJSON.String), &isolation); err != nil {
		return ""
	}
	if isolation.Type != "worktree" || isolation.SourceBranch == "" {
		return ""
	}
	return isolation.SourceBranch
}

func taskResourceInventoryBranchMerged(ctx context.Context, repo storage.Repo, task storage.Task) *bool {
	sourceBranch := taskResourceWorktreeSourceBranch(task)
	if sourceBranch == "" || task.Slug == "" {
		return nil
	}
	merged, isGitRepo, _, err := host.CheckGitAncestor(ctx, repo.Path, "openade/"+task.Slug, sourceBranch)
	if err != nil || !isGitRepo {
		return nil
	}
	return merged
}

func taskEventsDTO(events []storage.TaskEvent) []taskEventDTO {
	result := make([]taskEventDTO, 0, len(events))
	for _, event := range events {
		if payload := decodeNullableRawJSON(event.PayloadJSON); payload != nil {
			result = append(result, taskEventDTO{raw: payload})
			continue
		}
		fallback := taskEventFallbackDTO{
			ID:        event.ID,
			Type:      event.Type,
			CreatedAt: formatTime(event.CreatedAt),
		}
		if event.Status.Valid {
			fallback.Status = event.Status.String
		}
		if event.SourceType.Valid {
			fallback.SourceType = event.SourceType.String
		}
		if event.SourceLabel.Valid {
			fallback.SourceLabel = event.SourceLabel.String
		}
		result = append(result, taskEventDTO{fallback: fallback})
	}
	return result
}

func commentsDTO(comments []storage.Comment) []commentDTO {
	result := make([]commentDTO, 0, len(comments))
	for _, comment := range comments {
		anchor := decodeNullableRawJSON(comment.AnchorJSON)
		dto := commentDTO{
			ID:        comment.ID,
			TaskID:    comment.TaskID,
			Body:      comment.Body,
			Content:   comment.Body,
			Anchor:    anchor,
			CreatedAt: formatTime(comment.CreatedAt),
			UpdatedAt: formatTime(comment.UpdatedAt),
		}
		if anchor != nil {
			var legacy commentAnchorDTO
			if err := json.Unmarshal(*anchor, &legacy); err == nil {
				if len(legacy.Source) > 0 {
					source := legacy.Source
					dto.Source = &source
				}
				dto.SelectedText = &legacy.SelectedText
				if legacy.Author.ID != "" || legacy.Author.Email != "" {
					dto.Author = &legacy.Author
				}
			}
		}
		result = append(result, dto)
	}
	return result
}

func queuedTurnsDTO(turns []storage.QueuedTurn) []queuedTurnDTO {
	if len(turns) == 0 {
		return nil
	}
	return queuedTurnListDTO(turns)
}

func queuedTurnListDTO(turns []storage.QueuedTurn) []queuedTurnDTO {
	result := make([]queuedTurnDTO, 0, len(turns))
	for _, turn := range turns {
		result = append(result, queuedTurnToDTO(turn))
	}
	return result
}

func queuedTurnToDTO(turn storage.QueuedTurn) queuedTurnDTO {
	payload := decodeQueuedTurnPayload(turn.PayloadJSON)
	return queuedTurnDTO{
		ID:                  turn.ID,
		ClientRequestID:     payload.ClientRequestID,
		Type:                turn.Type,
		Input:               turn.Input,
		Status:              turn.Status,
		CreatedAt:           formatTime(turn.CreatedAt),
		UpdatedAt:           formatTime(turn.UpdatedAt),
		EventID:             payload.EventID,
		AppendSystemPrompt:  payload.AppendSystemPrompt,
		EnabledMCPServerIDs: payload.EnabledMCPServerIDs,
		HarnessID:           payload.HarnessID,
		ModelID:             payload.ModelID,
		Label:               payload.Label,
		IncludeComments:     payload.IncludeComments,
		Images:              compactOptionalArrayRawJSON(payload.Images),
		Thinking:            validThinking(payload.Thinking),
		FastMode:            payload.FastMode,
	}
}

func decodeQueuedTurnPayload(value sql.NullString) queuedTurnPayloadDTO {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return queuedTurnPayloadDTO{}
	}
	var payload queuedTurnPayloadDTO
	if err := json.Unmarshal([]byte(value.String), &payload); err != nil {
		return queuedTurnPayloadDTO{}
	}
	return payload
}

func compactOptionalArrayRawJSON(raw *json.RawMessage) *json.RawMessage {
	if raw == nil {
		return nil
	}
	trimmed := strings.TrimSpace(string(*raw))
	if trimmed == "" || !strings.HasPrefix(trimmed, "[") {
		return nil
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, *raw); err != nil {
		return nil
	}
	result := json.RawMessage(append([]byte(nil), compacted.Bytes()...))
	return &result
}

func compactOptionalArrayParam(field string, raw json.RawMessage) (*json.RawMessage, *core.RuntimeError) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	if !strings.HasPrefix(trimmed, "[") {
		return nil, invalidParams(field + " must be an array")
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, raw); err != nil {
		return nil, invalidParams(field + " must be an array")
	}
	result := json.RawMessage(append([]byte(nil), compacted.Bytes()...))
	return &result, nil
}

func validThinking(value string) string {
	switch value {
	case "low", "med", "high", "max":
		return value
	default:
		return ""
	}
}

func decodeNullableRawJSON(value sql.NullString) *json.RawMessage {
	if !value.Valid || value.String == "" {
		return nil
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, []byte(value.String)); err != nil {
		return nil
	}
	raw := json.RawMessage(append([]byte(nil), compacted.Bytes()...))
	return &raw
}

func compactOptionalObjectJSON(field string, raw json.RawMessage) (sql.NullString, *core.RuntimeError) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return sql.NullString{}, nil
	}
	if !strings.HasPrefix(trimmed, "{") {
		return sql.NullString{}, invalidParams(field + " must be an object")
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, raw); err != nil {
		return sql.NullString{}, invalidParams(field + " must be an object")
	}
	return sql.NullString{String: compacted.String(), Valid: true}, nil
}

func compactRequiredObjectRawJSON(field string, raw json.RawMessage) (json.RawMessage, *core.RuntimeError) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || !strings.HasPrefix(trimmed, "{") {
		return nil, invalidParams(field + " must be an object")
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, raw); err != nil {
		return nil, invalidParams(field + " must be an object")
	}
	return json.RawMessage(append([]byte(nil), compacted.Bytes()...)), nil
}

func parseParamTime(field string, value string) (time.Time, *core.RuntimeError) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, invalidParams(field + " must be an RFC3339 timestamp")
	}
	return parsed, nil
}

// openade-allow-explicit-any: encoding/json.Unmarshal requires a dynamic destination; callers pass concrete DTO pointers.
func decodeObject(raw json.RawMessage, target interface{}) *core.RuntimeError {
	if len(raw) == 0 {
		return invalidParams("params are required")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return invalidParams("params must be an object")
	}
	return nil
}

func clientRequestIDFromRaw(raw json.RawMessage) string {
	var params struct {
		ClientRequestID string `json:"clientRequestId"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return ""
	}
	return strings.TrimSpace(params.ClientRequestID)
}

func randomHexID() string {
	var data [8]byte
	if _, err := rand.Read(data[:]); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(data[:])
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func formatNullTime(value sql.NullTime) string {
	if !value.Valid {
		return ""
	}
	return formatTime(value.Time)
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func optionalNullString(value string) sql.NullString {
	if strings.TrimSpace(value) == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: value, Valid: true}
}

func invalidParams(message string) *core.RuntimeError {
	return &core.RuntimeError{Code: "invalid_params", Message: message}
}

func handlerError(err error) *core.RuntimeError {
	return &core.RuntimeError{Code: "handler_error", Message: err.Error()}
}
