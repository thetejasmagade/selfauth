// Package migrations is what the SQL stores share: reading db/migrations and comparing it with what
// a database has applied. A deliberately small scheme: SQL files applied in name order, each
// recorded with a checksum so an applied migration that was edited afterwards is detected. It runs
// only when you ask (never at startup: DATA-MODEL-003). Read each new migration before you apply it.
package migrations

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Migration is one directory of db/migrations containing migration.sql.
type Migration struct {
	Name     string
	SQL      string
	Checksum string
}

// Load reads dir/<name>/migration.sql for every <name>, in name order.
func Load(dir string) ([]Migration, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations: %w", err)
	}
	var out []Migration
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name(), "migration.sql"))
		if err != nil {
			return nil, fmt.Errorf("migration %s: %w", e.Name(), err)
		}
		sum := sha256.Sum256(data)
		out = append(out, Migration{Name: e.Name(), SQL: string(data), Checksum: hex.EncodeToString(sum[:])})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Status lists which migrations are applied and which are pending.
type Status struct {
	Applied []string
	Pending []string
}

// Classify compares the migrations on disk with the applied ones (name → checksum).
func Classify(all []Migration, done map[string]string) (Status, error) {
	var st Status
	known := map[string]struct{}{}
	for _, m := range all {
		known[m.Name] = struct{}{}
		sum, ok := done[m.Name]
		switch {
		case !ok:
			st.Pending = append(st.Pending, m.Name)
		case sum != m.Checksum:
			return st, fmt.Errorf("migration %s was applied and has been edited since; add a new migration instead of changing an applied one", m.Name)
		default:
			st.Applied = append(st.Applied, m.Name)
		}
	}
	for name := range done {
		if _, ok := known[name]; !ok {
			return st, fmt.Errorf("the database has migration %s, which is not in the migrations directory", name)
		}
	}
	return st, nil
}
