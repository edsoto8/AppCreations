# NCR_dispute: File Importer

A .NET 11 console app that imports files from a folder into a SQL Server staging table. It records every
import in a tracking table, validates the data with a stored procedure, archives each processed file and
e-mails an alert when something fails. It runs once and exits, so you schedule it with Windows Task
Scheduler, cron or a SQL Agent job.

The file layout, staging table and validation rules are **placeholders**. Replace them with your real file
spec. See [Adapting it to your file](#adapting-it-to-your-file).

## Contents

| Path | What it is |
|---|---|
| `src/FileImporter.Console` | Entry point: Generic Host, configuration, Serilog, DI. Builds `FileImporter.exe` |
| `src/FileImporter.Core` | Workflow, interfaces, CSV reader, SQL repository (Dapper + SqlBulkCopy), MailKit notifier, retry |
| `tests/FileImporter.Tests` | xUnit v3 tests: workflow with fakes, plus optional tests against a real SQL Server |
| `sql/` | Database scripts: tracking table, example staging table, example validation procedure |
| `samples/` | Sample CSV files: one valid, one that fails the file checks, one that the stored procedure rejects |

## How an import works

For each file that matches `Import:FilePattern` in `Import:SourceDirectory` (subfolders are not scanned):

1. **Skip files that are still being written.** A file changed less than `MinFileAgeSeconds` ago waits
   for the next run.
2. **Hash the file (SHA-256) and claim it** in `dbo.FileImport`. One locked SQL statement either creates
   a `Processing` record with a new `ImportId`, or finds that the same content is already
   `Processing`, `Imported` or `ArchivePending`. That check is what prevents duplicate imports.
3. **Read and check the file.** The reader checks the header, field counts, required fields, and the
   type and length of each value. Any problem fails the file, with line numbers in the error. The file
   is read only once, so the hash and the loaded rows always come from the same bytes. Malformed quoting
   (for example `"a"b`) and text that is not valid in the configured encoding are rejected, not loaded.
4. **Load and validate in one transaction.** SqlBulkCopy loads the rows into the staging table, tagged
   with the `ImportId` and row number. The validation procedure runs next, and the record is set to
   `Imported`. If validation fails, the whole transaction rolls back.
5. **Archive the file:** move it to `<SourceDirectory>\Archive`. If a file with the same name is already
   there, the new one gets a timestamp suffix.
6. **Log the outcome** with the file name, record count, import ID, status and elapsed time.

Every file is processed on its own, so one bad file never stops the others.

> The workflow claims the file in the tracking table (step 2) *before* parsing it. That way every
> failure, including a malformed file, has an `ImportId` for the alert e-mail and the audit trail, and
> duplicates are skipped without being parsed.

### What happens when something fails

| Situation | Status | File | Alert e-mail |
|---|---|---|---|
| Imported and archived | `Imported` | moved to `Archive` | no |
| Bad structure, missing or invalid fields | `Failed` | left in place | yes |
| Validation procedure rejects the data | `Failed` (nothing committed) | left in place | yes |
| SQL error during load or validation | `Failed` (nothing committed) | left in place | yes |
| Imported, but the archive move failed | `ArchivePending` | left in place | yes |
| Same content already `Imported` or `ArchivePending` | unchanged | moved to `Archive`, **not** imported again | no (logged as a warning) |
| Same content currently `Processing` (another run) | unchanged | left in place | no |
| Database unreachable before the record is created | none | left in place | yes (no Import ID) |

- **Failed files are retried on every run** until they import or someone removes them. A `Failed`
  record never blocks a retry, so fixing reference data and rerunning is enough. Each failed attempt
  sends another alert.
- **A committed import is never marked `Failed`**, even if the run is stopped during archiving, so it can
  never be loaded twice.
- **Archive failures never cause a re-import.** The data is already committed. On the next run the file
  is recognised by its hash, so only the move is retried and the record goes back to `Imported`.
- **Crash protection.** If the app dies mid-import, the open transaction rolls back and the record stays
  `Processing`. After `ProcessingTimeoutMinutes` it is treated as abandoned: it is set to `Failed` and
  the file is imported again.
- **Transient errors are retried** `Retry:MaxAttempts` times with a doubling delay. This covers SQL
  connection drops, deadlocks, timeouts, Azure SQL throttling, file locks and SMTP network errors.
  Permanent errors such as access denied, a bad column name or a validation failure are not retried.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Every file imported, or there was nothing to do (duplicates and in-progress files also count as OK) |
| 1 | At least one file failed or is `ArchivePending` |
| 2 | The run could not start or crashed (invalid configuration, source folder missing, cancelled) |

## Setup

### 1. Database

Run the scripts in `sql/` in order (SSMS, Azure Data Studio or `sqlcmd`). You can run them more than once.

| Script | Creates |
|---|---|
| `00_CreateDatabase.sql` | Optional `NcrDispute` database for local testing. Skip it for an existing database |
| `01_FileImport.sql` | `dbo.FileImport` tracking table (keep this one as it is) |
| `02_NcrDisputeStaging.sql` | `dbo.NcrDisputeStaging`, an **example** staging table |
| `03_usp_ValidateNcrDisputeImport.sql` | `dbo.usp_ValidateNcrDisputeImport`, an **example** validation procedure |

```bash
sqlcmd -S yourserver -d NcrDispute -E -i sql/01_FileImport.sql
```

The login the app uses needs `SELECT, INSERT, UPDATE` on `dbo.FileImport`, `INSERT` on the staging table
and `EXECUTE` on the validation procedure.

### 2. Configuration

Settings live in `src/FileImporter.Console/appsettings.json`, which is copied next to `FileImporter.exe`.
Later sources override earlier ones:

1. `appsettings.json`
2. `appsettings.{Environment}.json`, where the environment comes from `DOTNET_ENVIRONMENT`.
   `appsettings.Development.json` turns e-mail off.
3. User secrets (Development only)
4. Environment variables: `Section__Key`, for example `Database__ConnectionString`
5. Command line: `--Section:Key=value`, for example `--Import:SourceDirectory=D:\Drop`

| Setting | Default | Meaning |
|---|---|---|
| `Import:SourceDirectory` | `C:\Imports\NcrDispute` | Folder to scan. Relative paths are relative to the app folder |
| `Import:FilePattern` | `*.csv` | Which files to pick up |
| `Import:ArchiveFolderName` | `Archive` | Subfolder of the source folder that receives processed files |
| `Import:Delimiter` | `,` | Field delimiter |
| `Import:Encoding` | `utf-8` | File encoding, e.g. `windows-1252`. A byte-order mark overrides it. Invalid UTF-8 fails the file instead of loading garbled text |
| `Import:DateFormats` | ISO (`yyyy-MM-dd`, `yyyy-MM-dd HH:mm:ss`, `yyyy-MM-ddTHH:mm:ss`) | Accepted formats for `Date` columns. If you add a regional format such as `MM/dd/yyyy`, convert it in the validation procedure with an explicit style (`TRY_CONVERT(DATE, x, 101)`) |
| `Import:MinFileAgeSeconds` | `30` | Skip files modified more recently than this |
| `Import:ProcessingTimeoutMinutes` | `60` | When a stuck `Processing` record counts as abandoned |
| `Import:Columns` | example layout | File columns: `SourceName`, `DestinationName`, `Required`, `Type` (`Text`, `Integer`, `Decimal`, `Date`), `MaxLength` |
| `Database:ConnectionString` | *(empty)* | **Secret.** Set through an environment variable or user secrets |
| `Database:StagingTable` | `dbo.NcrDisputeStaging` | SqlBulkCopy target |
| `Database:ImportIdColumn` | `ImportId` | Staging column that receives the import ID |
| `Database:RowNumberColumn` | `SourceRowNumber` | Staging column that receives the row number. Leave empty to skip it |
| `Database:ValidationProcedure` | `dbo.usp_ValidateNcrDisputeImport` | Runs after the load with `@ImportId` |
| `Database:BulkCopyBatchSize` | `5000` | Rows per batch sent to the server (all batches are in one transaction) |
| `Database:BulkCopyTimeoutSeconds` | `600` | SqlBulkCopy timeout |
| `Database:CommandTimeoutSeconds` | `120` | Timeout for the other SQL commands, including the validation procedure |
| `Smtp:Enabled` | `true` | When `false`, alerts are only logged |
| `Smtp:Host` / `Port` / `Security` | `smtp.example.com` / `587` / `StartTls` | `Security` is one of `None`, `Auto`, `SslOnConnect`, `StartTls`, `StartTlsWhenAvailable` |
| `Smtp:Username` / `Password` | *(empty)* | Leave the username empty for an unauthenticated relay. The **password is a secret** |
| `Smtp:From` / `To` | placeholders | Sender and list of recipients |
| `Retry:MaxAttempts` | `3` | Attempts per operation, including the first. `1` turns retries off |
| `Retry:InitialDelaySeconds` | `2` | First retry delay, doubled each time |
| `Serilog:*` | console + daily file | Log levels and sinks. The log file is `logs/file-import-YYYYMMDD.log` in the app folder, kept 30 days |

Configuration is checked at startup. A missing connection string, empty column list or invalid e-mail
address stops the run with exit code 2 and a clear message.

### 3. Secrets

Do not put the connection string or SMTP password in `appsettings.json`.

**Production:** use environment variables for the account that runs the job:

```powershell
setx Database__ConnectionString "Server=sqlprod;Database=NcrDispute;Integrated Security=True;Encrypt=True" /M
setx Smtp__Password "..." /M
```

Windows authentication (`Integrated Security=True`) under a service account avoids storing a password at all.

**Development:** use user secrets (stored outside the repo):

```bash
cd src/FileImporter.Console
dotnet user-secrets set "Database:ConnectionString" "Server=localhost;Database=NcrDispute;Integrated Security=True;TrustServerCertificate=True"
dotnet user-secrets set "Smtp:Password" "..."
```

The app never logs connection strings or passwords. At startup it logs only the server and database
names.

## Running

```bash
# from the NCR_dispute folder
dotnet build
dotnet run --project src/FileImporter.Console                                       # uses appsettings.json
DOTNET_ENVIRONMENT=Development dotnet run --project src/FileImporter.Console -- --Import:SourceDirectory=/path/to/inbox
```

To try it end to end, copy the files from `samples/` into an empty folder and point
`Import:SourceDirectory` at it. The first file imports and is archived. The other two fail with line-level
errors, and their alerts appear in the log because e-mail is off in Development.

**Deploy:** `dotnet publish src/FileImporter.Console -c Release -o C:\Apps\NcrDisputeImport`, then
schedule `FileImporter.exe`. Ctrl+C or a service stop cancels cleanly: the current file is marked
`Failed` and left in place.

## Tests

```bash
dotnet test                       # all tests; SQL Server tests are skipped
FILEIMPORTER_TEST_SQL="Server=localhost,1433;User ID=sa;Password=...;TrustServerCertificate=True" dotnet test
```

- **Workflow tests** use the real CSV reader and archiver on temp folders, with an in-memory repository
  and notifier. They cover successful imports, validation failures, duplicates, archive failures and
  recovery, retries, one bad file among good ones, and cancellation.
- **SQL Server tests** (`tests/FileImporter.Tests/SqlServer`) run when `FILEIMPORTER_TEST_SQL` is set.
  They create a throwaway database from the `sql/` scripts and drop it afterwards. They cover duplicate
  claims (including 8 concurrent claims), abandoned records, the bulk load, rollback on validation
  failure, a `THROW`ing procedure, and the full end-to-end flow. The login needs permission to create
  databases.

`dotnet test` uses Microsoft.Testing.Platform (set in `global.json`).

## Adapting it to your file

1. **File layout:** edit `Import:Columns` in `appsettings.json`. Columns are matched to the header by
   name, case-insensitively and in any order. Columns that are not listed are ignored. Use
   `DestinationName` when the staging column has a different name.
2. **Staging table:** change `sql/02_NcrDisputeStaging.sql`, or point `Database:StagingTable` at an
   existing table. It needs a column for every `DestinationName`, plus `ImportIdColumn` and (optionally)
   `RowNumberColumn`. Text (`NVARCHAR`) columns are recommended: bad values then reach the validation
   procedure with a row number instead of failing the bulk load.
3. **Validation procedure:** replace the checks in `sql/03_usp_ValidateNcrDisputeImport.sql`, or point
   `Database:ValidationProcedure` at your own. The contract:
   - It takes `@ImportId UNIQUEIDENTIFIER`.
   - To pass: return no rows, or one row with `IsValid = 1`.
   - To fail: return `IsValid = 0, Message = '...'`, or `THROW` an error with number 50000 or higher.
   - It runs inside the importer's transaction, so it must not `COMMIT` or `ROLLBACK`. This also makes it
     a safe place to copy the rows into your final tables: if anything fails, everything rolls back.
   - If it checks against data from other files (like the example's "already imported" rule), keep the
     `sp_getapplock` at the top. It makes concurrent imports validate one at a time.
4. **Header-less, fixed-width or Excel files:** add a new `IImportFileReader` that returns an `ImportFile`
   (a `DataTable` plus a list of errors), and register it in `ServiceCollectionExtensions.AddFileImporter`.
5. **Tracking table:** its SQL is in `SqlImportRepository`. Change the script and the class together.

> Note: the console project's namespace is `FileImporter.ConsoleApp`, not `FileImporter.Console`. A
> namespace ending in `.Console` would hide `System.Console` in that project.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid configuration: Database:ConnectionString is required` | Set `Database__ConnectionString` for the account that runs the job (environment variables are per-user unless set with `/M`) |
| `Cannot list files in ...` / exit code 2 | The source folder does not exist or the account cannot read it |
| A file is never picked up | Check `FilePattern`. Files in subfolders are ignored. A file modified within `MinFileAgeSeconds` waits for the next run |
| `X was already imported as <id>` | The same content (not just the same name) was imported before, so the file was archived without a second load. To load it again on purpose, set that `dbo.FileImport` row to `Failed` |
| `Skipping X: the same content is being imported` | Another run is processing it, or a crashed run left `Processing`. It is retried after `ProcessingTimeoutMinutes`. To retry sooner, set the row to `Failed` |
| Status `ArchivePending` | The data is in. Fix the archive folder's permissions or locks; the next run moves the file without importing it again |
| `The given ColumnMapping does not match up with any column in the source or destination` | A `DestinationName`, `ImportIdColumn` or `RowNumberColumn` has no matching column in the staging table |
| `Received an invalid column length from the bcp client` | A value is longer than its staging column. Set `MaxLength` on that column so the file check catches it |
| `A connection was successfully established ... certificate chain was issued by an authority that is not trusted` | SqlClient encrypts by default. Install a trusted certificate on the server, or for dev only add `TrustServerCertificate=True` |
| No e-mails | Check `Smtp:Enabled` (off in Development) and look for `Could not send the failure alert` in the log. A mail failure never stops the import |
| Same failure e-mailed every run | Failed files are retried on each run by design. Fix the file or data, or move the file away |

**Useful queries**

```sql
-- Recent imports
SELECT TOP (50) ImportId, FileName, Status, RecordCount, StartedAtUtc, CompletedAtUtc, ArchivedAtUtc, ErrorMessage
FROM dbo.FileImport ORDER BY StartedAtUtc DESC;

-- Anything that needs attention
SELECT * FROM dbo.FileImport WHERE Status IN ('Failed', 'ArchivePending', 'Processing') ORDER BY StartedAtUtc DESC;

-- Rows from one import
SELECT * FROM dbo.NcrDisputeStaging WHERE ImportId = '<import id>' ORDER BY SourceRowNumber;
```

Logs: `logs/file-import-YYYYMMDD.log` next to `FileImporter.exe`. Every line has the file name, and the
file log adds structured properties such as `ImportId`, `RecordCount`, `ElapsedMs` and `Status`.
