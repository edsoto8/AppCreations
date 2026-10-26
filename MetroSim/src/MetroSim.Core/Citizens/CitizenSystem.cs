using MetroSim.Core.Buildings;
using MetroSim.Core.Economy;
using MetroSim.Core.Engine;
using MetroSim.Core.Traffic;

namespace MetroSim.Core.Citizens;

/// <summary>Daily schedules, trips, job matching, satisfaction, migration, births and deaths.</summary>
internal sealed class CitizenSystem
{
    private const int JobMatchesPerHour = 600;
    private const int JobSamples = 8;
    private const int ShopSamples = 6;

    private readonly Simulation _sim;
    private readonly List<int> _vacancies = [];
    private readonly List<int> _homes = [];
    private readonly List<int> _shops = [];
    private int[] _fertileAdults = new int[64];
    private int _shopsVersion = -1;

    public CitizenSystem(Simulation sim) => _sim = sim;

    public void UpdateTick(long tick, int minute)
    {
        var citizens = _sim.Citizens;
        for (int id = 1; id < citizens.HighWater; id++)
        {
            var c = citizens[id];
            if (c is null)
            {
                continue;
            }

            switch (c.State)
            {
                case CitizenState.AtHome:
                    if (c.JobId != 0 && minute == c.WorkStart)
                    {
                        StartTrip(c, TripPurpose.ToWork, c.HomeId, c.JobId, tick);
                    }
                    else if (minute == c.ShopMinute)
                    {
                        c.ShopMinute = -1;
                        GoShopping(c, tick);
                    }

                    break;
                case CitizenState.AtWork:
                    if (minute == (c.WorkStart + Citizen.WorkMinutes) % Simulation.TicksPerDay)
                    {
                        StartTrip(c, TripPurpose.ToHome, c.JobId, c.HomeId, tick);
                    }

                    break;
                case CitizenState.AtShop:
                    if (tick >= c.ActivityEnd)
                    {
                        StartTrip(c, TripPurpose.ToHome, c.ShopId, c.HomeId, tick);
                    }

                    break;
            }
        }
    }

    public void OnArrived(Vehicle v, long tick)
    {
        var c = _sim.Citizens[v.CitizenId];
        if (c is null || c.VehicleId != v.Id)
        {
            return;
        }

        c.VehicleId = 0;
        ArriveAt(c, v.Purpose, tick, (int)(tick - v.StartTick));
    }

    public void OnAborted(Vehicle v)
    {
        var c = _sim.Citizens[v.CitizenId];
        if (c is null || c.VehicleId != v.Id)
        {
            return;
        }

        // The road under the trip vanished: the citizen gives up and goes home off-road.
        c.VehicleId = 0;
        c.State = CitizenState.AtHome;
    }

    /// <summary>Assigns unemployed working-age citizens to the nearest of a sample of reachable vacancies.</summary>
    public void MatchJobs()
    {
        _vacancies.Clear();
        foreach (var b in _sim.Buildings)
        {
            if (b.Kind is BuildingKind.Commercial or BuildingKind.Industrial && b.IsOperating && b.AccessTile >= 0
                && b.Workers < b.Capacity)
            {
                _vacancies.Add(b.Id);
            }
        }

        if (_vacancies.Count == 0)
        {
            return;
        }

        var rng = _sim.Rng.Citizens;
        int budget = JobMatchesPerHour;
        foreach (var c in _sim.Citizens)
        {
            if (!c.IsWorkingAge || c.JobId != 0 || c.IsTravelling)
            {
                continue;
            }

            var home = _sim.Buildings[c.HomeId];
            if (home is null || home.AccessTile < 0)
            {
                continue;
            }

            if (budget-- == 0 || _vacancies.Count == 0)
            {
                break;
            }

            int best = -1;
            int bestDistance = int.MaxValue;
            int samples = Math.Min(JobSamples, _vacancies.Count);
            for (int s = 0; s < samples; s++)
            {
                int index = rng.Next(_vacancies.Count);
                var job = _sim.Buildings[_vacancies[index]]!;
                if (!_sim.Roads.Connected(home.AccessTile, job.AccessTile))
                {
                    continue;
                }

                int distance = Math.Abs(job.X - home.X) + Math.Abs(job.Y - home.Y);
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    best = index;
                }
            }

            if (best < 0)
            {
                continue;
            }

            var chosen = _sim.Buildings[_vacancies[best]]!;
            c.JobId = chosen.Id;
            c.WorkStart = 6 * 60 + rng.Next(4 * 60);
            c.DaysUnemployed = 0;
            c.FailedCommutes = 0;
            chosen.Workers++;
            if (chosen.Workers >= chosen.Capacity)
            {
                _vacancies[best] = _vacancies[^1];
                _vacancies.RemoveAt(_vacancies.Count - 1);
            }
        }
    }

    /// <summary>Households move into vacant homes at a rate set by residential demand.</summary>
    public void MigrateIn(int residentialDemand)
    {
        int households = EconomyModel.HouseholdsPerHour(residentialDemand);
        if (households == 0)
        {
            return;
        }

        _homes.Clear();
        foreach (var b in _sim.Buildings)
        {
            if (b.Kind == BuildingKind.Residential && b.IsOperating && b.AccessTile >= 0 && b.Residents < b.Capacity)
            {
                _homes.Add(b.Id);
            }
        }

        var rng = _sim.Rng.Citizens;
        for (int h = 0; h < households && _homes.Count > 0; h++)
        {
            int index = rng.Next(_homes.Count);
            var home = _sim.Buildings[_homes[index]]!;
            int size = Math.Min(home.Capacity - home.Residents, 1 + rng.Next(4));
            for (int k = 0; k < size; k++)
            {
                int age = k == 0 ? 18 + rng.Next(30)
                    : rng.Next(100) < 45 ? rng.Next(18)
                    : rng.Next(100) < 15 ? 65 + rng.Next(15)
                    : 18 + rng.Next(40);
                AddCitizen(home, age);
                _sim.Stats.TotalMovedIn++;
            }

            if (home.Residents >= home.Capacity)
            {
                _homes[index] = _homes[^1];
                _homes.RemoveAt(_homes.Count - 1);
            }
        }
    }

    /// <summary>Ageing, deaths, satisfaction, move-outs, births and tomorrow's shopping plans.</summary>
    public void Daily(int day)
    {
        var rng = _sim.Rng.Citizens;
        var buildings = _sim.Buildings;
        if (_fertileAdults.Length < buildings.HighWater)
        {
            _fertileAdults = new int[Math.Max(buildings.HighWater, _fertileAdults.Length * 2)];
        }

        Array.Clear(_fertileAdults);
        EnsureShops();
        var map = _sim.Map;
        int resTax = _sim.Budget.ResidentialTax;
        var citizens = _sim.Citizens;
        for (int id = 1; id < citizens.HighWater; id++)
        {
            var c = citizens[id];
            if (c is null)
            {
                continue;
            }

            var home = buildings[c.HomeId];
            if (home is null)
            {
                RemoveCitizen(c);
                _sim.Stats.TotalMovedOut++;
                continue;
            }

            if (day % Simulation.DaysPerYear == c.Id % Simulation.DaysPerYear)
            {
                c.Age++;
                if (c.Age == Citizen.RetirementAge && c.JobId != 0)
                {
                    QuitJob(c);
                }
            }

            if (c.Age >= 70 && (c.Age >= 100 || rng.Chance(c.Age - 65, home.CoveredByHealth ? 1600 : 800)))
            {
                RemoveCitizen(c);
                _sim.Stats.TotalDeaths++;
                continue;
            }

            c.DaysUnemployed = c.IsWorkingAge && c.JobId == 0 ? c.DaysUnemployed + 1 : 0;
            int tile = map.Index(home.X, home.Y);
            c.Satisfaction = EconomyModel.Satisfaction(new EconomyModel.SatisfactionInputs(
                home.Powered, home.Watered, home.DaysGarbage > 0, home.CoveredByHealth, home.CoveredByFire,
                map.Pollution[tile], map.LandValue[tile], c.IsWorkingAge, c.JobId != 0, c.DaysUnemployed,
                c.LastCommuteMinutes, resTax));
            c.UnhappyDays = c.Satisfaction < 25 ? c.UnhappyDays + 1 : 0;

            if ((c.UnhappyDays >= 3 && rng.Chance(1, 3)) || (c.DaysUnemployed > 6 && rng.Chance(1, 4)))
            {
                RemoveCitizen(c);
                _sim.Stats.TotalMovedOut++;
                continue;
            }

            if (c.Age is >= 18 and <= 45)
            {
                _fertileAdults[home.Id]++;
            }

            c.ShopMinute = -1;
            if (!c.IsChild && _shops.Count > 0 && rng.Chance(1, 3))
            {
                c.ShopMinute = c.JobId != 0 ? 18 * 60 + rng.Next(150) : 10 * 60 + rng.Next(6 * 60);
            }
        }

        for (int id = 1; id < buildings.HighWater; id++)
        {
            var b = buildings[id];
            if (b is { Kind: BuildingKind.Residential } && b.IsOperating && _fertileAdults[id] >= 2
                && b.Residents < b.Capacity && rng.Chance(1, 30))
            {
                AddCitizen(b, 0);
                _sim.Stats.TotalBirths++;
            }
        }
    }

    public void AddCitizen(Building home, int age)
    {
        var c = new Citizen { HomeId = home.Id, Age = age, State = CitizenState.AtHome };
        _sim.Citizens.Add(c);
        home.Residents++;
    }

    public void RemoveCitizen(Citizen c)
    {
        if (c.VehicleId != 0 && _sim.Traffic.Vehicles[c.VehicleId] is { } v && v.CitizenId == c.Id)
        {
            _sim.Traffic.Remove(v);
        }

        QuitJob(c);
        if (_sim.Buildings[c.HomeId] is { } home)
        {
            home.Residents--;
        }

        _sim.Citizens.Remove(c.Id);
    }

    public void QuitJob(Citizen c)
    {
        if (c.JobId == 0)
        {
            return;
        }

        if (_sim.Buildings[c.JobId] is { } job)
        {
            job.Workers--;
        }

        c.JobId = 0;
        if (c.State == CitizenState.AtWork)
        {
            c.State = CitizenState.AtHome;
        }
    }

    /// <summary>
    /// Handles citizens tied to buildings that are being removed or abandoned. Residents of those
    /// buildings leave the city; workers lose their jobs; visitors go home.
    /// </summary>
    public void Evict(Func<int, bool> isAffected)
    {
        var citizens = _sim.Citizens;
        for (int id = 1; id < citizens.HighWater; id++)
        {
            var c = citizens[id];
            if (c is null)
            {
                continue;
            }

            if (isAffected(c.HomeId))
            {
                RemoveCitizen(c);
                _sim.Stats.TotalMovedOut++;
                continue;
            }

            if (c.JobId != 0 && isAffected(c.JobId))
            {
                QuitJob(c);
            }

            if (c.State == CitizenState.AtShop && isAffected(c.ShopId))
            {
                c.State = CitizenState.AtHome;
            }
        }
    }

    /// <summary>Operating shops; a pure function of current buildings (keyed on the buildings version).</summary>
    private void EnsureShops()
    {
        if (_shopsVersion == _sim.BuildingsVersion)
        {
            return;
        }

        _shopsVersion = _sim.BuildingsVersion;
        _shops.Clear();
        foreach (var b in _sim.Buildings)
        {
            if (b.Kind == BuildingKind.Commercial && b.IsOperating && b.AccessTile >= 0)
            {
                _shops.Add(b.Id);
            }
        }
    }

    private void GoShopping(Citizen c, long tick)
    {
        EnsureShops();
        var home = _sim.Buildings[c.HomeId];
        if (home is null || home.AccessTile < 0 || _shops.Count == 0)
        {
            return;
        }

        var rng = _sim.Rng.Citizens;
        Building? best = null;
        int bestDistance = int.MaxValue;
        for (int s = 0; s < ShopSamples; s++)
        {
            var shop = _sim.Buildings[_shops[rng.Next(_shops.Count)]];
            if (shop is null || !shop.IsOperating || !_sim.Roads.Connected(home.AccessTile, shop.AccessTile))
            {
                continue;
            }

            int distance = Math.Abs(shop.X - home.X) + Math.Abs(shop.Y - home.Y);
            if (distance < bestDistance)
            {
                bestDistance = distance;
                best = shop;
            }
        }

        if (best is not null)
        {
            c.ShopId = best.Id;
            StartTrip(c, TripPurpose.ToShop, home.Id, best.Id, tick);
        }
    }

    private void StartTrip(Citizen c, TripPurpose purpose, int fromId, int toId, long tick)
    {
        var from = _sim.Buildings[fromId];
        var to = _sim.Buildings[toId];
        if (from is null || to is null || from.AccessTile < 0 || to.AccessTile < 0)
        {
            FailTrip(c, purpose);
            return;
        }

        int vehicleId = _sim.Traffic.Dispatch(VehicleKind.Car, purpose, c.Id, fromId, toId, from.AccessTile, to.AccessTile, tick);
        if (vehicleId > 0)
        {
            c.VehicleId = vehicleId;
            c.State = purpose switch
            {
                TripPurpose.ToWork => CitizenState.ToWork,
                TripPurpose.ToShop => CitizenState.ToShop,
                _ => CitizenState.ToHome,
            };
        }
        else if (vehicleId < 0)
        {
            ArriveAt(c, purpose, tick, 1);
        }
        else
        {
            FailTrip(c, purpose);
        }
    }

    private void FailTrip(Citizen c, TripPurpose purpose)
    {
        switch (purpose)
        {
            case TripPurpose.ToWork:
                c.FailedCommutes++;
                if (c.FailedCommutes >= 2)
                {
                    QuitJob(c);
                }

                break;
            case TripPurpose.ToHome:
                c.State = CitizenState.AtHome;
                break;
        }
    }

    private void ArriveAt(Citizen c, TripPurpose purpose, long tick, int minutes)
    {
        switch (purpose)
        {
            case TripPurpose.ToWork:
                if (_sim.Buildings[c.JobId] is { IsOperating: true })
                {
                    c.State = CitizenState.AtWork;
                    c.LastCommuteMinutes = minutes;
                    c.FailedCommutes = 0;
                }
                else
                {
                    QuitJob(c);
                    c.State = CitizenState.AtHome;
                }

                break;
            case TripPurpose.ToShop:
                if (_sim.Buildings[c.ShopId] is { IsOperating: true } shop)
                {
                    c.State = CitizenState.AtShop;
                    c.ActivityEnd = tick + 45;
                    shop.CustomersToday++;
                }
                else
                {
                    c.State = CitizenState.AtHome;
                }

                break;
            default:
                if (_sim.Buildings[c.HomeId] is null)
                {
                    RemoveCitizen(c);
                    _sim.Stats.TotalMovedOut++;
                }
                else
                {
                    c.State = CitizenState.AtHome;
                }

                break;
        }
    }
}
