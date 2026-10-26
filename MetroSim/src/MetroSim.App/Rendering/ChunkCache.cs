using System.Diagnostics;
using SkiaSharp;

namespace MetroSim.App.Rendering;

/// <summary>
/// Bitmap cache of the static map layer: one image per 16x16-tile chunk and resolution level
/// (pixels per tile, a power of two). An image stays valid while its chunk stamp and the snapshot
/// generation match. Painting is budgeted per frame; when the budget is spent a chunk falls back to
/// any valid image at another level (briefly blurry on zoom), or to its previous image when it just
/// changed, instead of stalling the frame.
/// Render thread only.
/// </summary>
public sealed class ChunkCache : IDisposable
{
    public static readonly int[] Levels = [2, 4, 8, 16, 32, 64];

    private readonly Dictionary<(int Cx, int Cy, int Level), Entry> _entries = [];
    private readonly ChunkPainter _painter = new();
    private readonly List<(int, int, int)> _evict = [];
    private long _frame;
    private long _frameStart;
    private int _generation = -1;

    /// <summary>Upper bound for cached pixels, in bytes.</summary>
    public long MemoryLimit { get; set; } = 192L << 20;

    /// <summary>Milliseconds per frame spent painting chunks that have a fallback. Infinity = always paint.</summary>
    public double PaintBudgetMilliseconds { get; set; } = 6;

    public long Bytes { get; private set; }

    public int Count => _entries.Count;

    public int PaintedThisFrame { get; private set; }

    public long TotalPainted { get; private set; }

    public static int LevelFor(double devicePixelsPerTile)
    {
        foreach (int level in Levels)
        {
            if (level >= devicePixelsPerTile * 0.9)
            {
                return level;
            }
        }

        return Levels[^1];
    }

    public void BeginFrame(StaticSnapshot s)
    {
        _frame++;
        _frameStart = Stopwatch.GetTimestamp();
        PaintedThisFrame = 0;
        if (s.Generation != _generation)
        {
            // A different city: nothing cached is reusable.
            Clear();
            _generation = s.Generation;
        }
    }

    /// <summary>The image for a chunk at <paramref name="level"/>, or a valid image at another level.</summary>
    public SKImage Get(StaticSnapshot s, int cx, int cy, int level)
    {
        int stamp = s.ChunkStamps[cy * s.ChunksX + cx];
        if (_entries.TryGetValue((cx, cy, level), out var entry) && entry.Stamp == stamp)
        {
            entry.LastUsed = _frame;
            return entry.Image;
        }

        bool overBudget = Stopwatch.GetElapsedTime(_frameStart).TotalMilliseconds > PaintBudgetMilliseconds;
        if (overBudget && Fallback(cx, cy, level, stamp) is { } fallback)
        {
            return fallback;
        }

        if (overBudget && entry is not null)
        {
            // Out of time: show the chunk as it was a moment ago and repaint it next frame.
            entry.LastUsed = _frame;
            return entry.Image;
        }

        return Paint(s, cx, cy, level, stamp);
    }

    public void EndFrame()
    {
        if (Bytes <= MemoryLimit)
        {
            return;
        }

        // Evict least recently used chunks that were not drawn this frame.
        _evict.Clear();
        foreach (var (key, entry) in _entries.OrderBy(e => e.Value.LastUsed))
        {
            if (Bytes <= MemoryLimit * 3 / 4 || entry.LastUsed == _frame)
            {
                break;
            }

            _evict.Add(key);
            Bytes -= entry.Bytes;
        }

        foreach (var key in _evict)
        {
            _entries[key].Image.Dispose();
            _entries.Remove(key);
        }
    }

    public void Clear()
    {
        foreach (var entry in _entries.Values)
        {
            entry.Image.Dispose();
        }

        _entries.Clear();
        Bytes = 0;
    }

    public void Dispose()
    {
        Clear();
        _painter.Dispose();
    }

    private SKImage? Fallback(int cx, int cy, int level, int stamp)
    {
        // Prefer the nearest finer level (downscaled looks better than upscaled).
        SKImage? best = null;
        int bestScore = int.MaxValue;
        foreach (int other in Levels)
        {
            if (other != level && _entries.TryGetValue((cx, cy, other), out var e) && e.Stamp == stamp)
            {
                int score = other > level ? other / level : level / other * 4;
                if (score < bestScore)
                {
                    bestScore = score;
                    best = e.Image;
                    e.LastUsed = _frame;
                }
            }
        }

        return best;
    }

    private SKImage Paint(StaticSnapshot s, int cx, int cy, int level, int stamp)
    {
        int tilesX = Math.Min(StaticSnapshot.ChunkSize, s.Width - cx * StaticSnapshot.ChunkSize);
        int tilesY = Math.Min(StaticSnapshot.ChunkSize, s.Height - cy * StaticSnapshot.ChunkSize);
        // The platform's native colour type keeps Skia on its fast blit paths (other formats are ~10x slower to draw).
        var info = new SKImageInfo(tilesX * level, tilesY * level, SKImageInfo.PlatformColorType, SKAlphaType.Premul);
        SKImage image;
        using (var bitmap = new SKBitmap(info))
        {
            _painter.Paint(bitmap, s, cx, cy, level);
            // An immutable bitmap shares its pixels with the image instead of copying them.
            bitmap.SetImmutable();
            image = SKImage.FromBitmap(bitmap);
        }

        var key = (cx, cy, level);
        if (_entries.TryGetValue(key, out var old))
        {
            old.Image.Dispose();
            Bytes -= old.Bytes;
        }

        long bytes = (long)info.Width * info.Height * 4;
        _entries[key] = new Entry(image, stamp, bytes) { LastUsed = _frame };
        Bytes += bytes;
        PaintedThisFrame++;
        TotalPainted++;
        return image;
    }

    private sealed class Entry(SKImage image, int stamp, long bytes)
    {
        public SKImage Image { get; } = image;

        public int Stamp { get; } = stamp;

        public long Bytes { get; } = bytes;

        public long LastUsed { get; set; }
    }
}
