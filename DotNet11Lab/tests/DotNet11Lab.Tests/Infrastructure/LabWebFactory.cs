using Microsoft.AspNetCore.Mvc.Testing;

namespace DotNet11Lab.Tests.Infrastructure;

/// <summary>Hosts the full dashboard (including the in-process /api endpoints) for integration tests.</summary>
public sealed class LabWebFactory : WebApplicationFactory<Program>;
