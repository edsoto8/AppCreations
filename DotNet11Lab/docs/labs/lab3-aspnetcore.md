# Lab 3: ASP.NET Core 11 API playground

Page: `/labs/aspnetcore` (InteractiveServer). API: `src/DotNet11Lab.Api` (mapped in-process under `/api` by the dashboard,
or standalone with `dotnet run --project src/DotNet11Lab.Api`). Tests: `tests/DotNet11Lab.Tests/Lab3AspNetCore/`.

The playground sends **real HTTP requests** from the Blazor circuit to this app's own endpoints (`IHttpClientFactory`,
base address from `NavigationManager.BaseUri`). Only relative paths under `/api/` and `/openapi/` are accepted; request
bodies are capped at 32 KB and responses at 256 KB. Presets (`ApiPresets.cs`) cover every validation path, every union
case and every error status; a test asserts each preset's expected status.

| Endpoint | Shows |
|---|---|
| `POST /api/checkout` | `AddValidation()`: sync attributes, async attributes, nested objects, collection items, `IAsyncValidatableObject` |
| `POST /api/v10style/checkout` | the same contract validated by hand in the handler (`.DisableValidation()`) |
| `POST /api/payments/authorize` | union `PaymentMethod` in the body, union `PaymentOutcome` in the response, 404/409/422 |
| `GET /api/orders/{id}` · `GET /api/orders/{id}/events` | 404 problem; Server-Sent Events (`itemSchema` in OpenAPI 3.2) |
| `GET /api/errors/throw` | unhandled exception turned into a 500 problem with `traceId` |
| `GET /openapi/v1.json` · `GET /openapi/v1-3.1.json` | the same API as OpenAPI 3.2.0 (default) and 3.1 |

---

## 1. Async DataAnnotations validation (Stable, new in 11)

**What's new.** `System.ComponentModel.DataAnnotations` gains `AsyncValidationAttribute` (override
`IsValidAsync(object?, ValidationContext, CancellationToken)`), `IAsyncValidatableObject`
(`IAsyncEnumerable<ValidationResult> ValidateAsync(ValidationContext, CancellationToken)`) and
`Validator.TryValidateObjectAsync` / `ValidateObjectAsync` / `ValidatePropertyAsync` / `ValidateValueAsync`.
`builder.Services.AddValidation()` makes Minimal APIs run all of them before the handler and answer `400` with a
`ValidationProblem` (keys such as `Lines[1].Sku`, `ShipTo.Name`).

**Why it matters.** Existence, uniqueness, entitlement and coupon checks used to live in handlers or filters. Now one
declarative model carries every rule, the request's `CancellationToken` flows into each lookup, and the same attribute
works in Blazor forms.

**Example.** `KnownCustomerAttribute`, `ValidCouponAttribute`, `KnownSkuAttribute` and `CheckoutRequest`
(`Commerce/CheckoutContracts.cs`). Services come from `ValidationContext.GetRequiredService<T>()`.

**Previous approach.** `LegacyCheckoutEndpoint.HandleAsync`: `Validator.TryValidateObject` (sync only, does not recurse),
manual recursion into nested objects and items, every async lookup and cross-field rule written imperatively, then
`TypedResults.ValidationProblem`. A test proves both endpoints return identical error dictionaries.

**Performance.** Measured on the page ("Same invalid request, two endpoints", medians of 5): with four 35 ms lookups,
`AddValidation()` answered in about one lookup's time (~38 ms on the dev container) while the sequential manual version
took ~145 ms, because async attributes on a member start together and collection items are validated in parallel. Your
numbers will differ; the page measures them on each run.

**Found while building (verified by tests).**
- When a type implements `IAsyncValidatableObject`, Minimal API validation calls **only** `ValidateAsync`; the inherited
  synchronous `Validate` is not invoked. `CheckoutRequest.ValidateAsync` therefore yields the sync rules itself.
- An async-only attribute cannot run under the synchronous `Validator` APIs (our attributes throw from `IsValid`).
- In Development, `RouteHandlerOptions.ThrowOnBadRequest` is `true`, so unreadable bodies become exceptions. `AddLabApi()`
  turns it off; the framework then answers a `400` `ValidationProblem` keyed by JSON path (e.g. `$.method`).

**Production use cases.** Sign-up uniqueness, order checkout (customer, coupon, SKU checks), entitlement checks.

**When not to use.** As a substitute for atomic enforcement (two requests can both pass a uniqueness check: enforce it at
write time, as the 409 stock conflict does); for expensive remote calls on hot endpoints without caching.

Docs: [What's new in ASP.NET Core 11](https://learn.microsoft.com/aspnet/core/release-notes/aspnetcore-11),
[Minimal API validation](https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis#validation),
[System.ComponentModel.DataAnnotations](https://learn.microsoft.com/dotnet/api/system.componentmodel.dataannotations).

## 2. C# 15 unions in JSON bodies (Stable, new in 11)

**What's new.** System.Text.Json serializes a union as its active case, without wrapper or `$type`. Minimal APIs use this
for return values and bodies. Object cases need a classifier to deserialize:
`[JsonUnion(TypeClassifier = typeof(JsonUnionTypeStructuralClassifier))]` matches by property names. Unions are not
supported for route, query, header or form binding.

**Example.** `union PaymentOutcome(PaymentApproved, PaymentDeclined, PaymentRequiresAction)` is the 200 body of
`/api/payments/authorize`; `union PaymentMethod(CardPayment, BankTransferPayment, WalletPayment)` is a body property.
`PaymentProcessor.Authorize` switches over the union exhaustively. A body whose `method` matches no case gets a 400 with
the classifier's message under `$.method`; a missing `method` (default union, `Value == null`) is a 400 from the handler.

**Previous approach.** `[JsonPolymorphic]` + `[JsonDerivedType]` with a `$type` discriminator, or a wrapper object with
nullable members per outcome.

**Performance.** Same serializer path as ordinary objects; value-type cases are boxed (the union stores `object?`).

**When not to use.** Cases with overlapping property sets (classification becomes ambiguous); consumers or generators that
require an explicit discriminator.

Docs: [Union types in System.Text.Json](https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/union-types),
[C# union types](https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/union).

## 3. OpenAPI 3.2 (Stable, new in 11)

**What's new.** `Microsoft.AspNetCore.OpenApi` 11 emits `"openapi": "3.2.0"` by default. `OpenApiOptions.OpenApiVersion =
Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_1` (verified enum: `OpenApi2_0`, `OpenApi3_0`, `OpenApi3_1`, `OpenApi3_2`)
selects another version. Several documents can be registered: `AddOpenApi("v1", ...)` and `AddOpenApi("v1-3.1", ...)`,
both served by one `MapOpenApi()` at `/openapi/{documentName}.json`.

**Observed in this app.** Unions become `anyOf` of the case schemas, without a discriminator, in both versions. The only
line that differs besides the version (`3.2.0` vs `3.1.2`) is the Server-Sent Events response: 3.2 writes `itemSchema`,
3.1 writes the extension `x-oai-itemSchema`. The page fetches both documents and lists every differing line.

**When not to use 3.2.** If client generators, gateways or linters reject 3.2, pin `OpenApi3_1`.

Docs: [OpenAPI in ASP.NET Core](https://learn.microsoft.com/aspnet/core/fundamentals/openapi/overview),
[OpenAPI 3.2 specification](https://spec.openapis.org/oas/v3.2.0.html).

## 4. ProblemDetails (Baseline: no changes in 11)

`AddProblemDetails(o => o.CustomizeProblemDetails = ApiProblems.Customize)` adds `instance` and `traceId` to every
problem, including automatic validation responses. `ApiProblems` centralizes status codes and a machine-readable `code`
(400 invalid input, 404 unknown resource, 409 state conflict, 422 semantically wrong, 500 unexpected).
`ApiExceptionFilter` (on the `/api` group) logs unhandled exceptions and returns a generic 500 problem, independent of the
host's HTML error page; `ApiExceptionHandler` (`IExceptionHandler`, `/api` only) serves hosts that call
`UseExceptionHandler()`. Because the playground's `HttpClient` propagates `traceparent`, all problems from one demo run share
the caller's trace id.

Docs: [Handle errors in ASP.NET Core APIs](https://learn.microsoft.com/aspnet/core/fundamentals/error-handling-api),
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457).
