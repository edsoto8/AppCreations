using DotNet11Lab.Core.Source;

namespace DotNet11Lab.Tests.Infrastructure;

public class CSharpHighlighterTests
{
    [Fact]
    public void Tokens_round_trip_to_the_original_text()
    {
        const string code = "public union Payment(Approved, Declined);\n// note\nvar s = $\"x {y}\"; int n = 42;\n#if DEBUG\n[Obsolete] closed record S;";

        var tokens = CSharpHighlighter.Tokenize(code);

        Assert.Equal(code, string.Concat(tokens.Select(t => t.Text)));
    }

    [Theory]
    [InlineData("union", TokenKind.ContextualKeyword)]
    [InlineData("closed", TokenKind.ContextualKeyword)]
    [InlineData("extension", TokenKind.ContextualKeyword)]
    [InlineData("return", TokenKind.Keyword)]
    [InlineData("\"text\"", TokenKind.String)]
    [InlineData("// comment", TokenKind.Comment)]
    [InlineData("3.14", TokenKind.Number)]
    [InlineData("Payment", TokenKind.Type)]
    public void Classifies_single_tokens(string code, TokenKind expected)
    {
        var token = Assert.Single(CSharpHighlighter.Tokenize(code));
        Assert.Equal(expected, token.Kind);
    }

    [Fact]
    public void Raw_string_literals_are_a_single_token()
    {
        const string code = "\"\"\"\n{ \"a\": 1 }\n\"\"\"";
        Assert.Equal(TokenKind.String, Assert.Single(CSharpHighlighter.Tokenize(code)).Kind);
    }
}
