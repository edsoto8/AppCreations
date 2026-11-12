using System.Collections.Frozen;

namespace DotNet11Lab.Core.Source;

public enum TokenKind { Plain, Keyword, ContextualKeyword, Type, String, Comment, Number, Preprocessor, Attribute, Method }

public readonly record struct Token(TokenKind Kind, string Text);

/// <summary>
/// A small lexical C# highlighter. It does not need a JavaScript library or Roslyn workspace and knows the C# 15
/// contextual keywords (<c>union</c>, <c>closed</c>, <c>extension</c>, <c>with</c>). Output is a token list that the
/// UI renders as encoded spans, so no raw HTML is ever produced from source text.
/// </summary>
public static class CSharpHighlighter
{
    private static readonly FrozenSet<string> Keywords = FrozenSet.Create(StringComparer.Ordinal,
        "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked", "class", "const",
        "continue", "decimal", "default", "delegate", "do", "double", "else", "enum", "event", "explicit", "extern",
        "false", "finally", "fixed", "float", "for", "foreach", "goto", "if", "implicit", "in", "int", "interface",
        "internal", "is", "lock", "long", "namespace", "new", "null", "object", "operator", "out", "override",
        "params", "private", "protected", "public", "readonly", "ref", "return", "sbyte", "sealed", "short",
        "sizeof", "stackalloc", "static", "string", "struct", "switch", "this", "throw", "true", "try", "typeof",
        "uint", "ulong", "unchecked", "unsafe", "ushort", "using", "virtual", "void", "volatile", "while");

    private static readonly FrozenSet<string> Contextual = FrozenSet.Create(StringComparer.Ordinal,
        "add", "and", "async", "await", "by", "closed", "descending", "dynamic", "equals", "extension", "field",
        "file", "from", "get", "global", "group", "init", "into", "join", "let", "managed", "nameof", "nint",
        "not", "notnull", "nuint", "on", "or", "orderby", "partial", "record", "remove", "required", "scoped",
        "select", "set", "union", "unmanaged", "value", "var", "when", "where", "with", "yield");

    public static IReadOnlyList<Token> Tokenize(string code)
    {
        var tokens = new List<Token>();
        var i = 0;
        var atLineStart = true;
        while (i < code.Length)
        {
            var c = code[i];
            var start = i;

            if (c == '\n') { Add(TokenKind.Plain, "\n"); i++; atLineStart = true; continue; }
            if (char.IsWhiteSpace(c)) { while (i < code.Length && code[i] != '\n' && char.IsWhiteSpace(code[i])) i++; Add(TokenKind.Plain, code[start..i]); continue; }

            if (c == '#' && atLineStart) { i = LineEnd(i); Add(TokenKind.Preprocessor, code[start..i]); continue; }
            atLineStart = false;

            if (c == '/' && Peek(1) == '/') { i = LineEnd(i); Add(TokenKind.Comment, code[start..i]); continue; }
            if (c == '/' && Peek(1) == '*')
            {
                var end = code.IndexOf("*/", i + 2, StringComparison.Ordinal);
                i = end < 0 ? code.Length : end + 2;
                Add(TokenKind.Comment, code[start..i]);
                continue;
            }

            if (c == '"' || c == '\'' || ((c == '$' || c == '@') && (Peek(1) == '"' || (Peek(1) is '$' or '@' && Peek(2) == '"'))))
            {
                i = ReadString(i);
                Add(TokenKind.String, code[start..i]);
                continue;
            }

            if (char.IsDigit(c))
            {
                while (i < code.Length && (char.IsLetterOrDigit(code[i]) || code[i] is '_' or '.') && !(code[i] == '.' && !char.IsDigit(Peek(1)))) i++;
                Add(TokenKind.Number, code[start..i]);
                continue;
            }

            if (char.IsLetter(c) || c == '_' || c == '@')
            {
                i++;
                while (i < code.Length && (char.IsLetterOrDigit(code[i]) || code[i] == '_')) i++;
                var word = code[start..i];
                Add(Classify(word, i), word);
                continue;
            }

            if (c == '[' && LooksLikeAttribute(i))
            {
                Add(TokenKind.Plain, "[");
                i++;
                var s = i;
                while (i < code.Length && (char.IsLetterOrDigit(code[i]) || code[i] is '_' or '.')) i++;
                if (i > s) Add(TokenKind.Attribute, code[s..i]);
                continue;
            }

            Add(TokenKind.Plain, c.ToString());
            i++;
        }
        return Merge(tokens);

        char Peek(int offset) => i + offset < code.Length ? code[i + offset] : '\0';
        void Add(TokenKind kind, string text) => tokens.Add(new Token(kind, text));
        int LineEnd(int from) { var e = code.IndexOf('\n', from); return e < 0 ? code.Length : e; }

        TokenKind Classify(string word, int end)
        {
            if (Keywords.Contains(word)) return TokenKind.Keyword;
            if (Contextual.Contains(word)) return TokenKind.ContextualKeyword;
            var next = end;
            while (next < code.Length && code[next] == ' ') next++;
            if (next < code.Length && code[next] == '(' && char.IsUpper(word[0])) return TokenKind.Method;
            if (char.IsUpper(word[0])) return TokenKind.Type;
            if (next < code.Length && code[next] == '(') return TokenKind.Method;
            return TokenKind.Plain;
        }

        bool LooksLikeAttribute(int at)
        {
            // An attribute list starts a line (ignoring indentation) and is followed by an identifier.
            var back = at - 1;
            while (back >= 0 && code[back] is ' ' or '\t') back--;
            return (back < 0 || code[back] == '\n') && at + 1 < code.Length && char.IsUpper(code[at + 1]);
        }

        int ReadString(int at)
        {
            var verbatim = false;
            var p = at;
            while (p < code.Length && code[p] is '$' or '@') { if (code[p] == '@') verbatim = true; p++; }
            var quote = code[p];
            // Raw string literal """...""".
            if (quote == '"' && p + 2 < code.Length && code[p + 1] == '"' && code[p + 2] == '"')
            {
                var q = p;
                while (q < code.Length && code[q] == '"') q++;
                var fence = new string('"', q - p);
                var close = code.IndexOf(fence, q, StringComparison.Ordinal);
                return close < 0 ? code.Length : close + fence.Length;
            }
            p++;
            while (p < code.Length)
            {
                if (code[p] == '\\' && !verbatim) { p += 2; continue; }
                if (code[p] == quote)
                {
                    if (verbatim && p + 1 < code.Length && code[p + 1] == quote) { p += 2; continue; }
                    return p + 1;
                }
                if (code[p] == '\n' && !verbatim) return p;
                p++;
            }
            return code.Length;
        }
    }

    private static List<Token> Merge(List<Token> tokens)
    {
        var merged = new List<Token>(tokens.Count);
        foreach (var t in tokens)
        {
            if (merged.Count > 0 && merged[^1].Kind == TokenKind.Plain && t.Kind == TokenKind.Plain)
                merged[^1] = new Token(TokenKind.Plain, merged[^1].Text + t.Text);
            else
                merged.Add(t);
        }
        return merged;
    }
}
