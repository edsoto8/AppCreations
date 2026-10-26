using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Media.Imaging;
using MetroSim.Core.Engine;
using MetroSim.Core.Scenarios;
using MetroSim.Core.World;

namespace MetroSim.App.Tests.Support;

public static class Pixels
{
    /// <summary>(R, G, B) of a rendered pixel at a window point (BGRA frame buffer).</summary>
    public static (byte R, byte G, byte B) At(WriteableBitmap bitmap, Point p)
    {
        using var fb = bitmap.Lock();
        int x = Math.Clamp((int)(p.X * fb.Dpi.X / 96), 0, fb.Size.Width - 1);
        int y = Math.Clamp((int)(p.Y * fb.Dpi.Y / 96), 0, fb.Size.Height - 1);
        int value = Marshal.ReadInt32(fb.Address, y * fb.RowBytes + x * 4);
        return ((byte)(value >> 16), (byte)(value >> 8), (byte)value);
    }

    /// <summary>Number of pixels that differ noticeably between two frames of the same size.</summary>
    public static int Differences(WriteableBitmap a, WriteableBitmap b)
    {
        using var fa = a.Lock();
        using var fb = b.Lock();
        int count = 0;
        for (int y = 0; y < Math.Min(fa.Size.Height, fb.Size.Height); y += 2)
        {
            for (int x = 0; x < Math.Min(fa.Size.Width, fb.Size.Width); x += 2)
            {
                int va = Marshal.ReadInt32(fa.Address, y * fa.RowBytes + x * 4);
                int vb = Marshal.ReadInt32(fb.Address, y * fb.RowBytes + x * 4);
                int d = Math.Abs((va & 0xFF) - (vb & 0xFF)) + Math.Abs(((va >> 8) & 0xFF) - ((vb >> 8) & 0xFF))
                    + Math.Abs(((va >> 16) & 0xFF) - ((vb >> 16) & 0xFF));
                if (d > 30)
                {
                    count++;
                }
            }
        }

        return count;
    }
}

public static class MapSearch
{
    /// <summary>Top-left of a fully buildable size x size area near the map centre (grass or sand, no roads).</summary>
    public static (int X, int Y) BuildableArea(Simulation sim, int size)
    {
        var map = sim.Map;
        var (ox, oy) = DemoCity.FindFlatRegion(map, size + 8);
        for (int radius = 0; radius < map.Width; radius++)
        {
            for (int dy = -radius; dy <= radius; dy++)
            {
                for (int dx = -radius; dx <= radius; dx++)
                {
                    int x = ox + 4 + dx;
                    int y = oy + 4 + dy;
                    if (Clear(map, x, y, size))
                    {
                        return (x, y);
                    }
                }
            }
        }

        throw new InvalidOperationException("No buildable area on this map.");
    }

    private static bool Clear(CityMap map, int x0, int y0, int size)
    {
        for (int y = y0; y < y0 + size; y++)
        {
            for (int x = x0; x < x0 + size; x++)
            {
                if (!map.InBounds(x, y) || !map.IsBuildableLand(map.Index(x, y)) || map.BuildingAt[map.Index(x, y)] != 0)
                {
                    return false;
                }
            }
        }

        return true;
    }
}

public static class EntityStoreExtensions
{
    /// <summary>Live entities as a list (EntityStore only offers a struct enumerator).</summary>
    public static List<T> All<T>(this EntityStore<T> store)
        where T : class, IEntity
    {
        var list = new List<T>(store.Count);
        foreach (var item in store)
        {
            list.Add(item);
        }

        return list;
    }
}
