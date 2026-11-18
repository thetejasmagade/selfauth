package auth

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Structured logger with mandatory redaction (SEC-LOG-001).

var redactedKeys = map[string]struct{}{
	"password": {}, "currentpassword": {}, "newpassword": {}, "token": {}, "csrftoken": {},
	"cookie": {}, "set-cookie": {}, "authorization": {}, "secret": {}, "secrethash": {},
	"passwordhash": {}, "tokenhash": {},
}

// 32+ character base64url/hex runs look like tokens or hashes; never log them.
var (
	tokenLike = regexp.MustCompile(`[A-Za-z0-9_-]{32,}`)
	uuidLike  = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// Redact returns value with secrets removed. UUIDs (request, user and session
// IDs) are identifiers, not secrets, and are kept for correlation (SEC-LOG-003).
func Redact(value any, depth int) any {
	if depth > 8 {
		return "[depth]"
	}
	switch v := value.(type) {
	case string:
		return tokenLike.ReplaceAllStringFunc(v, func(run string) string {
			if uuidLike.MatchString(run) {
				return run
			}
			return "[redacted]"
		})
	case error:
		return map[string]any{"message": Redact(v.Error(), depth+1)}
	case []any:
		out := make([]any, len(v))
		for i, e := range v {
			out[i] = Redact(e, depth+1)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, e := range v {
			if _, secret := redactedKeys[strings.ToLower(k)]; secret {
				out[k] = "[redacted]"
			} else {
				out[k] = Redact(e, depth+1)
			}
		}
		return out
	}
	return value
}

// LogSink receives one JSON line per entry.
type LogSink interface{ Write(line string) }

type stdoutSink struct{ mu sync.Mutex }

func (s *stdoutSink) Write(line string) {
	s.mu.Lock()
	fmt.Fprintln(os.Stdout, line)
	s.mu.Unlock()
}

// MemoryLogSink collects lines in memory (tests, conformance inspectLogs).
type MemoryLogSink struct {
	mu    sync.Mutex
	lines []string
}

func (s *MemoryLogSink) Write(line string) {
	s.mu.Lock()
	s.lines = append(s.lines, line)
	s.mu.Unlock()
}
func (s *MemoryLogSink) Lines() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.lines...)
}

// Logger writes redacted JSON lines.
type Logger struct{ sink LogSink }

func NewLogger(sink LogSink) *Logger {
	if sink == nil {
		sink = &stdoutSink{}
	}
	return &Logger{sink: sink}
}

func (l *Logger) Log(level, message string, fields map[string]any) {
	entry := map[string]any{}
	if clean, ok := Redact(fields, 0).(map[string]any); ok {
		for k, v := range clean {
			entry[k] = v
		}
	}
	entry["level"] = level
	entry["time"] = ISO(time.Now())
	entry["message"] = message
	line, err := json.Marshal(entry)
	if err != nil {
		line = []byte(`{"level":"error","message":"log entry could not be encoded"}`)
	}
	l.sink.Write(string(line))
}
