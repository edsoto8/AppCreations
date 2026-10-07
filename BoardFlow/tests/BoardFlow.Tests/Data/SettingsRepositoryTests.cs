using BoardFlow.Data.Repositories;
using BoardFlow.Tests.Support;

namespace BoardFlow.Tests.Data;

public sealed class SettingsRepositoryTests
{
    [Fact]
    public void Get_MissingKey_ReturnsNull()
    {
        using var db = new TestDatabase();
        Assert.Null(db.Settings.Get("nothing"));
    }

    [Fact]
    public void SetThenGet_ReturnsValue()
    {
        using var db = new TestDatabase();

        db.Settings.Set("Theme", "dark");

        Assert.Equal("dark", db.Settings.Get("Theme"));
    }

    [Fact]
    public void Set_Overwrites_PreviousValue()
    {
        using var db = new TestDatabase();
        db.Settings.Set("Theme", "dark");

        db.Settings.Set("Theme", "light");

        Assert.Equal("light", db.Settings.Get("Theme"));
        Assert.Equal(1, db.CountRows("AppSettings"));
    }

    [Fact]
    public void Set_Null_RemovesTheKey()
    {
        using var db = new TestDatabase();
        db.Settings.Set("Theme", "dark");

        db.Settings.Set("Theme", null);

        Assert.Null(db.Settings.Get("Theme"));
        Assert.Equal(0, db.CountRows("AppSettings"));
    }

    [Fact]
    public void Set_Null_OnMissingKey_IsHarmless()
    {
        using var db = new TestDatabase();
        db.Settings.Set("never-set", null);
        Assert.Null(db.Settings.Get("never-set"));
    }

    [Fact]
    public void Set_EmptyString_IsStoredAsEmptyNotRemoved()
    {
        using var db = new TestDatabase();
        db.Settings.Set("Blank", "");
        Assert.Equal("", db.Settings.Get("Blank"));
    }

    [Fact]
    public void Keys_AreIndependent()
    {
        using var db = new TestDatabase();
        db.Settings.Set("A", "1");
        db.Settings.Set("B", "2");

        db.Settings.Set("A", null);

        Assert.Null(db.Settings.Get("A"));
        Assert.Equal("2", db.Settings.Get("B"));
    }

    [Theory]
    [InlineData("42", 42L)]
    [InlineData("0", 0L)]
    [InlineData("-7", -7L)]
    [InlineData("9223372036854775807", long.MaxValue)]
    public void GetLong_ParsesNumbers(string stored, long expected)
    {
        using var db = new TestDatabase();
        db.Settings.Set("Number", stored);
        Assert.Equal(expected, db.Settings.GetLong("Number"));
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData("12.5")]
    [InlineData("99999999999999999999")]
    public void GetLong_ReturnsNullForNonNumbers(string stored)
    {
        using var db = new TestDatabase();
        db.Settings.Set("Number", stored);
        Assert.Null(db.Settings.GetLong("Number"));
    }

    [Fact]
    public void GetLong_MissingKey_ReturnsNull()
    {
        using var db = new TestDatabase();
        Assert.Null(db.Settings.GetLong("missing"));
    }

    [Fact]
    public void Settings_PersistAfterReopen()
    {
        using var db = new TestDatabase();
        db.Settings.Set(SettingsRepository.LastBoardId, "17");
        db.Settings.Set("Theme", "dark");
        db.Settings.Set("Removed", "x");
        db.Settings.Set("Removed", null);

        db.Reopen();

        Assert.Equal(17, db.Settings.GetLong(SettingsRepository.LastBoardId));
        Assert.Equal("dark", db.Settings.Get("Theme"));
        Assert.Null(db.Settings.Get("Removed"));
    }
}
