namespace SkyHop.Core;

public readonly record struct Rect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;
    public double Bottom => Y + Height;
}

public static class Collision
{
    public static bool CircleIntersectsRect(double cx, double cy, double radius, Rect rect)
    {
        var nearestX = Math.Clamp(cx, rect.X, rect.Right);
        var nearestY = Math.Clamp(cy, rect.Y, rect.Bottom);
        var dx = cx - nearestX;
        var dy = cy - nearestY;
        return dx * dx + dy * dy < radius * radius;
    }
}
