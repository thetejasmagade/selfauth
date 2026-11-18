package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestLoggerRedactsSecrets(t *testing.T) {
	sink := &MemoryLogSink{}
	log := NewLogger(sink)
	token := RandomToken()
	log.Log("info", "event", map[string]any{
		"password":  "hunter2hunter2",
		"nested":    map[string]any{"Authorization": "Bearer abc", "note": "link is /x#token=" + token},
		"requestId": "0b8f6c1e-5b0e-4f6e-9c53-3d2f5a1c9a77",
		"error":     errors.New("failed for " + token),
	})
	line := sink.Lines()[0]
	for _, secret := range []string{"hunter2hunter2", "Bearer abc", token} {
		if strings.Contains(line, secret) {
			t.Errorf("log line leaks %q: %s", secret, line)
		}
	}
	if !strings.Contains(line, "0b8f6c1e-5b0e-4f6e-9c53-3d2f5a1c9a77") {
		t.Errorf("UUIDs identify requests and must be kept: %s", line)
	}
}
