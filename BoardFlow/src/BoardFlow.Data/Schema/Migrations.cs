namespace BoardFlow.Data.Schema;

/// <summary>
/// The ordered schema history. Never edit a released migration; append a new one with the next version.
/// </summary>
public static class Migrations
{
    public static IReadOnlyList<Migration> All { get; } =
    [
        new(1, "Initial schema", """
            CREATE TABLE Workspaces (
                Id        INTEGER PRIMARY KEY,
                Name      TEXT    NOT NULL,
                CreatedAt TEXT    NOT NULL,
                UpdatedAt TEXT    NOT NULL
            );

            CREATE TABLE Boards (
                Id          INTEGER PRIMARY KEY,
                WorkspaceId INTEGER NOT NULL REFERENCES Workspaces(Id) ON DELETE CASCADE,
                Name        TEXT    NOT NULL,
                Description TEXT    NOT NULL DEFAULT '',
                SortOrder   INTEGER NOT NULL,
                CreatedAt   TEXT    NOT NULL,
                UpdatedAt   TEXT    NOT NULL
            );
            CREATE INDEX IX_Boards_WorkspaceId ON Boards(WorkspaceId, SortOrder);

            CREATE TABLE BoardColumns (
                Id        INTEGER PRIMARY KEY,
                BoardId   INTEGER NOT NULL REFERENCES Boards(Id) ON DELETE CASCADE,
                Name      TEXT    NOT NULL,
                SortOrder INTEGER NOT NULL,
                CreatedAt TEXT    NOT NULL,
                UpdatedAt TEXT    NOT NULL
            );
            CREATE INDEX IX_BoardColumns_BoardId ON BoardColumns(BoardId, SortOrder);

            CREATE TABLE Cards (
                Id          INTEGER PRIMARY KEY,
                ColumnId    INTEGER NOT NULL REFERENCES BoardColumns(Id) ON DELETE CASCADE,
                Title       TEXT    NOT NULL,
                Description TEXT    NOT NULL DEFAULT '',
                Priority    INTEGER NOT NULL DEFAULT 0 CHECK (Priority BETWEEN 0 AND 4),
                DueDate     TEXT    NULL,
                IsArchived  INTEGER NOT NULL DEFAULT 0 CHECK (IsArchived IN (0, 1)),
                SortOrder   INTEGER NOT NULL,
                CreatedAt   TEXT    NOT NULL,
                UpdatedAt   TEXT    NOT NULL
            );
            CREATE INDEX IX_Cards_ColumnId ON Cards(ColumnId, IsArchived, SortOrder);

            CREATE TABLE Labels (
                Id           INTEGER PRIMARY KEY,
                WorkspaceId  INTEGER NOT NULL REFERENCES Workspaces(Id) ON DELETE CASCADE,
                Name         TEXT    NOT NULL,
                DisplayColor TEXT    NOT NULL,
                UNIQUE (WorkspaceId, Name COLLATE NOCASE)
            );

            CREATE TABLE CardLabels (
                CardId  INTEGER NOT NULL REFERENCES Cards(Id) ON DELETE CASCADE,
                LabelId INTEGER NOT NULL REFERENCES Labels(Id) ON DELETE CASCADE,
                PRIMARY KEY (CardId, LabelId)
            ) WITHOUT ROWID;
            CREATE INDEX IX_CardLabels_LabelId ON CardLabels(LabelId);

            CREATE TABLE AppSettings (
                Key   TEXT PRIMARY KEY,
                Value TEXT NOT NULL
            ) WITHOUT ROWID;
            """),
    ];

    public static int LatestVersion => All[^1].Version;
}
