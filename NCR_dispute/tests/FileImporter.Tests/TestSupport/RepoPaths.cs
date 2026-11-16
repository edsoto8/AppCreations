namespace FileImporter.Tests.TestSupport;

/// <summary>Finds the sql/ and samples/ folders by walking up from the test output folder.</summary>
public static class RepoPaths
{
    public static string Root { get; } = FindRoot();

    public static string SqlFolder => Path.Combine(Root, "sql");

    public static string SamplesFolder => Path.Combine(Root, "samples");

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "sql", "01_FileImport.sql")))
            {
                return dir.FullName;
            }
        }

        throw new DirectoryNotFoundException("Could not find the NCR_dispute folder (with sql/01_FileImport.sql) above " + AppContext.BaseDirectory);
    }
}
