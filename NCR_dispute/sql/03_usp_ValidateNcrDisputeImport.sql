/*
    Example validation procedure (Database:ValidationProcedure). Replace the checks with your own rules.

    Contract with the importer:
      * Called with @ImportId after the rows are bulk loaded, inside the importer's transaction.
      * To pass:  return no rows, or one row with IsValid = 1.
      * To fail:  return one row with IsValid = 0 and a Message, or raise an error (THROW / RAISERROR).
        Everything (staging rows, and anything this procedure changed) is then rolled back and the file is
        left in the source folder.
      * Do not COMMIT or ROLLBACK here. Because this runs inside the importer's transaction, it is also a safe
        place to move validated rows into the final tables: if anything fails, all of it is rolled back.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_ValidateNcrDisputeImport
    @ImportId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Errors TABLE (SourceRowNumber INT NOT NULL, Problem NVARCHAR(400) NOT NULL);

    -- Values that must convert to real types.
    INSERT INTO @Errors (SourceRowNumber, Problem)
    SELECT SourceRowNumber, CONCAT(N'Amount "', Amount, N'" is not a valid amount')
    FROM dbo.NcrDisputeStaging
    WHERE ImportId = @ImportId AND TRY_CONVERT(DECIMAL(19, 4), Amount) IS NULL;

    INSERT INTO @Errors (SourceRowNumber, Problem)
    SELECT SourceRowNumber, CONCAT(N'TransactionDate "', TransactionDate, N'" is not a valid date or is in the future')
    FROM dbo.NcrDisputeStaging
    WHERE ImportId = @ImportId
      AND (TRY_CONVERT(DATE, TransactionDate) IS NULL OR TRY_CONVERT(DATE, TransactionDate) > CAST(SYSUTCDATETIME() AS DATE));

    -- Business rule examples.
    INSERT INTO @Errors (SourceRowNumber, Problem)
    SELECT SourceRowNumber, CONCAT(N'Amount ', Amount, N' must be greater than zero')
    FROM dbo.NcrDisputeStaging
    WHERE ImportId = @ImportId AND TRY_CONVERT(DECIMAL(19, 4), Amount) <= 0;

    INSERT INTO @Errors (SourceRowNumber, Problem)
    SELECT s.SourceRowNumber, CONCAT(N'DisputeId ', s.DisputeId, N' appears more than once in the file')
    FROM dbo.NcrDisputeStaging AS s
    WHERE s.ImportId = @ImportId
      AND EXISTS (SELECT 1 FROM dbo.NcrDisputeStaging AS d
                  WHERE d.ImportId = @ImportId AND d.DisputeId = s.DisputeId AND d.SourceRowNumber <> s.SourceRowNumber);

    INSERT INTO @Errors (SourceRowNumber, Problem)
    SELECT s.SourceRowNumber, CONCAT(N'DisputeId ', s.DisputeId, N' was already imported from ', f.FileName)
    FROM dbo.NcrDisputeStaging AS s
    JOIN dbo.NcrDisputeStaging AS p ON p.DisputeId = s.DisputeId AND p.ImportId <> @ImportId
    JOIN dbo.FileImport AS f ON f.ImportId = p.ImportId AND f.Status IN ('Imported', 'ArchivePending')
    WHERE s.ImportId = @ImportId;

    IF NOT EXISTS (SELECT 1 FROM @Errors)
    BEGIN
        -- Optional: INSERT INTO dbo.NcrDispute (...) SELECT ... FROM dbo.NcrDisputeStaging WHERE ImportId = @ImportId;
        SELECT CAST(1 AS BIT) AS IsValid, CAST(NULL AS NVARCHAR(4000)) AS Message;
        RETURN;
    END;

    DECLARE @ErrorCount INT = (SELECT COUNT(*) FROM @Errors);
    DECLARE @FirstErrors NVARCHAR(MAX) =
    (
        SELECT STRING_AGG(CONCAT(N'Row ', SourceRowNumber, N': ', Problem), NCHAR(13) + NCHAR(10))
               WITHIN GROUP (ORDER BY SourceRowNumber)
        FROM (SELECT TOP (20) SourceRowNumber, Problem FROM @Errors ORDER BY SourceRowNumber) AS e
    );

    SELECT CAST(0 AS BIT) AS IsValid,
           CAST(CONCAT(@ErrorCount, N' validation error(s).', NCHAR(13), NCHAR(10), @FirstErrors) AS NVARCHAR(4000)) AS Message;
END;
GO
