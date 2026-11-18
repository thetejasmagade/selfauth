// Package routes is where your application's own routes live.
package routes

import (
	"net/http"

	"example.com/app/internal/ginauth"
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
func Register(r *gin.Engine, a *ginauth.Auth) {
	api := r.Group("/api")
	api.GET("/hello", a.RequireAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"hello": a.Context(c).User.Email})
	})
}
