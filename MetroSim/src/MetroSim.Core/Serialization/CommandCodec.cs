using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Serialization;

/// <summary>Binary encoding of <see cref="GameCommand"/>s: a tag byte followed by the fields.</summary>
public static class CommandCodec
{
    private const byte RoadTag = 1;
    private const byte PowerLineTag = 2;
    private const byte BulldozeTag = 3;
    private const byte ZoneTag = 4;
    private const byte PlaceTag = 5;
    private const byte TaxTag = 6;

    public static void Write(BinaryWriter w, GameCommand command)
    {
        switch (command)
        {
            case BuildRoadCommand c:
                w.Write(RoadTag);
                WriteRect(w, c.X0, c.Y0, c.X1, c.Y1);
                w.Write((byte)c.Type);
                break;
            case BuildPowerLineCommand c:
                w.Write(PowerLineTag);
                WriteRect(w, c.X0, c.Y0, c.X1, c.Y1);
                break;
            case BulldozeCommand c:
                w.Write(BulldozeTag);
                WriteRect(w, c.X0, c.Y0, c.X1, c.Y1);
                break;
            case ZoneCommand c:
                w.Write(ZoneTag);
                WriteRect(w, c.X0, c.Y0, c.X1, c.Y1);
                w.Write((byte)c.Zone);
                break;
            case PlaceBuildingCommand c:
                w.Write(PlaceTag);
                w.Write((byte)c.Kind);
                w.Write(c.X);
                w.Write(c.Y);
                break;
            case SetTaxCommand c:
                w.Write(TaxTag);
                w.Write((byte)c.Zone);
                w.Write(c.Percent);
                break;
            default:
                throw new ArgumentException($"Unknown command {command.GetType().Name}.");
        }
    }

    public static GameCommand Read(BinaryReader r)
    {
        var command = ReadUnchecked(r);
        if (!CommandProcessor.IsWellFormed(command))
        {
            throw new SaveFormatException("The command log contains an invalid command.");
        }

        return command;
    }

    private static GameCommand ReadUnchecked(BinaryReader r)
    {
        byte tag = r.ReadByte();
        switch (tag)
        {
            case RoadTag:
            {
                var (x0, y0, x1, y1) = ReadRect(r);
                return new BuildRoadCommand(x0, y0, x1, y1, (RoadType)r.ReadByte());
            }

            case PowerLineTag:
            {
                var (x0, y0, x1, y1) = ReadRect(r);
                return new BuildPowerLineCommand(x0, y0, x1, y1);
            }

            case BulldozeTag:
            {
                var (x0, y0, x1, y1) = ReadRect(r);
                return new BulldozeCommand(x0, y0, x1, y1);
            }

            case ZoneTag:
            {
                var (x0, y0, x1, y1) = ReadRect(r);
                return new ZoneCommand(x0, y0, x1, y1, (ZoneType)r.ReadByte());
            }

            case PlaceTag:
                return new PlaceBuildingCommand((BuildingKind)r.ReadByte(), r.ReadInt32(), r.ReadInt32());
            case TaxTag:
                return new SetTaxCommand((ZoneType)r.ReadByte(), r.ReadInt32());
            default:
                throw new SaveFormatException($"Unknown command tag {tag}.");
        }
    }

    private static void WriteRect(BinaryWriter w, int x0, int y0, int x1, int y1)
    {
        w.Write(x0);
        w.Write(y0);
        w.Write(x1);
        w.Write(y1);
    }

    private static (int, int, int, int) ReadRect(BinaryReader r) => (r.ReadInt32(), r.ReadInt32(), r.ReadInt32(), r.ReadInt32());
}
