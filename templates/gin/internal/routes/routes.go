// Package routes is where your application's own routes live.
package routes

import (
	"net/http"

	"selfauth-app/internal/ginauth"
	"selfauth-app/internal/store"
	"github.com/gin-gonic/gin"
)

// Register mounts application routes. Examples of the guard styles:
//
//   - a.RequireAuth(): any signed-in user;
//   - a.RequirePermission("x.y"): a permission from selfauth.config.json (an unknown
//     permission panics when the route is defined);
//   - a.ProtectedRoutes(group): a group that denies every route lacking a guard.
//
// Route guards run on the server for every request (AUTHZ-CORE-002).
//
// db is the database SelfAuth uses, for your own tables: db.SQL on PostgreSQL, MySQL and SQLite,
// db.Mongo on MongoDB. Both are nil while the app runs on the in-memory store.
func Register(r *gin.Engine, a *ginauth.Auth, db store.DB) {
	api := r.Group("/api")
	api.GET("/hello", a.RequireAuth(), func(c *gin.Context) {
		database := "in-memory"
		if db.SQL != nil || db.Mongo != nil {
			database = "connected"
		}
		c.JSON(http.StatusOK, gin.H{"hello": a.Context(c).User.Email, "database": database})
	})
}
