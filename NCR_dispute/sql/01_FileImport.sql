/*
    File import tracking table. One row per import attempt.

    Status values (see FileImporter.Core/Models/ImportStatus.cs):
        Processing      the import has started and has not finished
        Imported        data committed and validated (ArchivedAtUtc is set once the file is moved)
        Failed          reading, loading or validation failed; nothing was committed; the file was left in place
        ArchivePending  data committed but the file could not be moved; the next run only retries the move

    Duplicate protection: a file whose content (SHA-256) already has a Processing, Imported or ArchivePending row is
    never loaded again. Failed rows do not block a retry. The filtered unique index enforces this in the database.

    The importer's SQL for this table is in FileImporter.Core/Infrastructure/SqlImportRepository.cs.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;  -- required for the filtered index (sqlcmd defaults to OFF)
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;  -- the table and its indexes are created together or not at all

IF OBJECT_ID(N'dbo.FileImport', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FileImport
    (
        ImportId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_FileImport PRIMARY KEY,
        FileName        NVARCHAR(260)    NOT NULL,
        FileHash        NVARCHAR(64)     NOT NULL,   -- SHA-256 of the file content, hex
        FileSizeBytes   BIGINT           NOT NULL,
        Status          VARCHAR(20)      NOT NULL
            CONSTRAINT CK_FileImport_Status CHECK (Status IN ('Processing', 'Imported', 'Failed', 'ArchivePending')),
        RecordCount     INT              NULL,
        StartedAtUtc    DATETIME2(3)     NOT NULL CONSTRAINT DF_FileImport_StartedAtUtc DEFAULT SYSUTCDATETIME(),
        CompletedAtUtc  DATETIME2(3)     NULL,
        ArchivedAtUtc   DATETIME2(3)     NULL,
        ArchivePath     NVARCHAR(1000)   NULL,
        ErrorMessage    NVARCHAR(4000)   NULL,
        MachineName     NVARCHAR(128)    NULL
    );

    CREATE INDEX IX_FileImport_FileHash ON dbo.FileImport (FileHash) INCLUDE (Status, StartedAtUtc);

    CREATE UNIQUE INDEX UX_FileImport_FileHash_Active ON dbo.FileImport (FileHash)
        WHERE Status IN ('Processing', 'Imported', 'ArchivePending');

    CREATE INDEX IX_FileImport_StartedAtUtc ON dbo.FileImport (StartedAtUtc DESC) INCLUDE (FileName, Status);
END;

COMMIT TRANSACTION;
GO
