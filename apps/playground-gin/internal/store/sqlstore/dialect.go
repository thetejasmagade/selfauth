// Package sqlstore is the auth.Store for MySQL and SQLite, on database/sql. The schema is the
// migration in db/migrations (generated from the PostgreSQL reference, so the tables and their
// names are the same on every database). The two databases differ in a handful of places, all in
// this file: how a time is stored, how a duplicate is written or ignored, how a unique violation
// is recognised and whether a row can be locked.
//
// Atomicity (DATA-MODEL-002): user creation runs in one transaction, token consumption and
// session revocation are conditional updates, and rate-limit updates serialize per key (a row
// lock on MySQL; SQLite runs one connection, so writers queue).
package sqlstore

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Kind is the database an Open call connects to.
type Kind string

const (
	MySQL  Kind = "mysql"
	SQLite Kind = "sqlite"
)

type dialect struct {
	kind Kind
	// insertIgnore starts an INSERT that does nothing when the row already exists.
	insertIgnore string
	// upsertCredential finishes the credentials INSERT so a second write replaces the hash.
	upsertCredential string
	// upsertRole finishes the roles INSERT so a second write refreshes is_system.
	upsertRole string
	// lock is appended to a SELECT that must hold its row until the transaction ends.
	lock string
}

func dialectFor(kind Kind) dialect {
	if kind == MySQL {
		return dialect{
			kind:             MySQL,
			insertIgnore:     "INSERT IGNORE INTO",
			upsertCredential: "ON DUPLICATE KEY UPDATE secret_hash = VALUES(secret_hash), updated_at = VALUES(updated_at)",
			upsertRole:       "ON DUPLICATE KEY UPDATE is_system = VALUES(is_system)",
			lock:             " FOR UPDATE",
		}
	}
	return dialect{
		kind:             SQLite,
		insertIgnore:     "INSERT OR IGNORE INTO",
		upsertCredential: "ON CONFLICT (user_id, type) DO UPDATE SET secret_hash = excluded.secret_hash, updated_at = excluded.updated_at",
		upsertRole:       "ON CONFLICT (name) DO UPDATE SET is_system = excluded.is_system",
	}
}

// t is how a time goes into a query. SQLite keeps milliseconds since the epoch (what Prisma
// writes, so a file can move between the TypeScript and Go apps); MySQL takes a UTC time.
func (d dialect) t(v time.Time) any {
	if d.kind == SQLite {
		return v.UnixMilli()
	}
	return v.UTC()
}

func (d dialect) tp(v *time.Time) any {
	if v == nil {
		return nil
	}
	return d.t(*v)
}

// isDuplicate reports whether err is a unique violation naming column (the email).
func (d dialect) isDuplicate(err error, column string) bool {
	if err == nil {
		return false
	}
	if d.kind == MySQL {
		var m *mysql.MySQLError
		return errors.As(err, &m) && m.Number == 1062 && strings.Contains(m.Message, column)
	}
	return strings.Contains(err.Error(), "UNIQUE constraint failed") && strings.Contains(err.Error(), column)
}

// nullTime scans a stored time whichever way the driver returns it.
type nullTime struct {
	Time  time.Time
	Valid bool
}

func (n *nullTime) Scan(src any) error {
	n.Valid = true
	switch v := src.(type) {
	case nil:
		n.Valid = false
	case time.Time:
		n.Time = v.UTC()
	case int64:
		n.Time = time.UnixMilli(v).UTC()
	case float64:
		n.Time = time.UnixMilli(int64(v)).UTC()
	case []byte:
		return n.parse(string(v))
	case string:
		return n.parse(v)
	default:
		return fmt.Errorf("cannot read a time from %T", src)
	}
	return nil
}

func (n *nullTime) parse(s string) error {
	if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
		n.Time = time.UnixMilli(ms).UTC()
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05.999999999", "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			n.Time = t.UTC()
			return nil
		}
	}
	return fmt.Errorf("cannot read a time from %q", s)
}

func (n nullTime) ptr() *time.Time {
	if !n.Valid {
		return nil
	}
	t := n.Time
	return &t
}

func (n nullTime) val() time.Time { return n.Time }
