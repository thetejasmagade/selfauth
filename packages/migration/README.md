# @selfauth/migration

Migration orchestration for SelfAuth projects. It doesn't replace your
migration tool; it drives the native one (Prisma Migrate) and adds safety
analysis on top.

- `MigrationAdapter`: the contract each database/ORM adapter implements
  (`inspect`, `status`, `plan`, `migrate`, `generate`, `validate`, `rollback`).
- `PrismaMigrationAdapter`: an implementation over the project's own `prisma`
  binary.
- `analyzeSql()`, `splitStatements()` and `createdObjects()` flag
  statements that lose data (drops, type changes, renames), developer
  migrations that change SelfAuth's tables, and SelfAuth migrations that touch
  tables it doesn't own. The developer's own tables can be extended freely.
- `manifestSchema` describes the `selfauth.manifest.json` ownership manifest.

This package is a development-time dependency of `@selfauth/cli`, and the
`selfauth db …` commands use it. Generated applications never import it. See
the [repository](https://github.com/thetejasmagade/selfauth).
