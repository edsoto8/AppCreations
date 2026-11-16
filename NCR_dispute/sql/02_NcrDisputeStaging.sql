/*
    Example staging table loaded by SqlBulkCopy. Replace the data columns with your file layout.

    Rules:
      * Column names must match the "DestinationName" values in appsettings.json (Import:Columns).
      * ImportId and SourceRowNumber are filled by the importer (Database:ImportIdColumn / Database:RowNumberColumn).
      * Data columns are text on purpose: a bad value never fails the bulk load, and the validation procedure
        reports it with its row number instead. Convert to real types when moving rows to the final tables.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;  -- required for the filtered index (sqlcmd defaults to OFF)
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;  -- the table and its indexes are created together or not at all

IF OBJECT_ID(N'dbo.NcrDisputeStaging', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NcrDisputeStaging
    (
        StagingId        BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_NcrDisputeStaging PRIMARY KEY,
        ImportId         UNIQUEIDENTIFIER NOT NULL,
        SourceRowNumber  INT              NOT NULL,

        -- File columns (placeholder layout)
        DisputeId        NVARCHAR(50)     NULL,
        AccountNumber    NVARCHAR(34)     NULL,
        TransactionDate  NVARCHAR(30)     NULL,
        Amount           NVARCHAR(30)     NULL,
        CurrencyCode     NVARCHAR(3)      NULL,
        ReasonCode       NVARCHAR(10)     NULL,
        Description      NVARCHAR(500)    NULL,

        LoadedAtUtc      DATETIME2(3)     NOT NULL CONSTRAINT DF_NcrDisputeStaging_LoadedAtUtc DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_NcrDisputeStaging_ImportId ON dbo.NcrDisputeStaging (ImportId);
    CREATE INDEX IX_NcrDisputeStaging_DisputeId ON dbo.NcrDisputeStaging (DisputeId) INCLUDE (ImportId);
END;

COMMIT TRANSACTION;
GO
