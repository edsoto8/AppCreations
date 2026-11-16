# CLAUDE.md

NCR_dispute is a .NET 11 console app that imports files (CSV for now) into a SQL Server staging table:
Generic Host, Serilog, Dapper, SqlBulkCopy (Microsoft.Data.SqlClient), MailKit, xUnit v3. `README.md`
covers configuration, the failure matrix and troubleshooting. The file layout, staging table and
validation procedure are placeholders that the owner will replace with the real spec.

## Commands

Run from this `NCR_dispute/` folder:

```bash
dotnet build                                   # warnings are errors
dotnet test                                    # Microsoft.Testing.Platform (global.json); SQL tests skip
FILEIMPORTER_TEST_SQL="Server=localhost,1433;User ID=sa;Password=...;TrustServerCertificate=True" dotnet test
dotnet test --filter-class "*FileImportServiceTests"
DOTNET_ENVIRONMENT=Development Database__ConnectionString="..." dotnet run --project src/FileImporter.Console -- --Import:SourceDirectory=/path/to/inbox
```

## Architecture

- `FileImporter.Core/Services/FileImportService.cs` is the whole workflow: hash → claim in tracking
  table → read/check → load + validate + mark Imported (one transaction) → archive. Each file is
  processed on its own, and `ProcessFileAsync` never throws except on cancellation.
- Interfaces in `Core/Abstractions`: `IImportFileReader` (CSV now), `IImportRepository` (all SQL),
  `IFileArchiver`, `INotificationService`. Implementations live in `Core/Infrastructure`.
- `SqlImportRepository` holds all SQL. The tracking table name and columns must match
  `sql/01_FileImport.sql`. The staging table and procedure come from configuration.
- `RetryPolicy` only wraps operations that are safe to repeat. `LoadAndValidateAsync` is safe because it
  locks the tracking row and returns early when the status is already Imported.
- `FileImporter.Console` only hosts: options binding and validation (`OptionsSetup.cs`), Serilog and exit
  codes. Its namespace is `FileImporter.ConsoleApp` so that `System.Console` is not hidden.

## Invariants

- Never archive a file whose import failed. Never load a file whose hash has an active record
  (Processing, Imported or ArchivePending). `Failed` records never block a retry.
- An archive failure must not undo or repeat the import: the status becomes ArchivePending and the next
  run only moves the file.
- Never log connection strings or passwords (use `ConnectionInfo.Describe`).
- Status strings are in `Models/ImportStatus.cs` and in the CHECK constraint in `sql/01_FileImport.sql`.
  Change both together.

## Conventions

- C#, four-space indent, file-scoped namespaces, `sealed` classes, primary constructors for services.
- Tests: no mocking library. Use the fakes in `tests/FileImporter.Tests/TestSupport` and real temp folders.
  Test names follow `Subject_Condition_Outcome`. SQL tests use `SqlServerFixture`, which builds a
  throwaway database from `sql/`.
- Package versions are pinned in the csproj files. The SDK is pinned to 11.0.100 in `global.json`
  (rollForward latestFeature).
