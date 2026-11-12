using DotNet11Lab.Api.Errors;
using DotNet11Lab.Api.Payments;
using System.Net.ServerSentEvents;
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Http.HttpResults;

namespace DotNet11Lab.Api.Commerce;

public sealed record OrderEvent(string OrderId, string Stage, int Sequence, DateTimeOffset At);

/// <summary>Checkout, orders and payments endpoints under /api.</summary>
public static class CommerceEndpoints
{
    public static RouteGroupBuilder MapCommerceEndpoints(this RouteGroupBuilder api)
    {
        // <snippet:AspNetCore.MapCheckout>
        // No validation code in the handler: AddValidation() runs [Required], [KnownCustomer] (async), [KnownSku] on each
        // line (async, in parallel), IValidatableObject.Validate and IAsyncValidatableObject.ValidateAsync, and
        // answers 400 application/problem+json before the handler is invoked.
        api.MapPost("/checkout", CheckoutAsync)
            .WithName("Checkout")
            .WithTags("Checkout")
            .WithSummary("Place an order (.NET 11 async validation)")
            .WithDescription("Validated by AddValidation(): sync attributes, async attributes and an IAsyncValidatableObject cross-field rule.")
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);
        // </snippet:AspNetCore.MapCheckout>

        api.MapPost("/v10style/checkout", LegacyCheckoutEndpoint.HandleAsync)
            .DisableValidation()
            .WithName("CheckoutV10Style")
            .WithTags("Checkout")
            .WithSummary("Place an order (.NET 10-style manual validation)")
            .WithDescription("Same contract, validated by hand inside the handler for comparison.")
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        api.MapGet("/orders/{orderId}", GetOrder)
            .WithName("GetOrder")
            .WithTags("Orders")
            .WithSummary("Get an order")
            .ProducesProblem(StatusCodes.Status404NotFound);

        // <snippet:AspNetCore.MapOrderEvents>
        // Server-Sent Events: OpenAPI 3.2 describes each event with "itemSchema"; 3.1 has no way to say it.
        api.MapGet("/orders/{orderId}/events", OrderEvents)
            .WithName("StreamOrderEvents")
            .WithTags("Orders")
            .WithSummary("Stream the order's fulfilment timeline as Server-Sent Events")
            .ProducesProblem(StatusCodes.Status404NotFound);
        // </snippet:AspNetCore.MapOrderEvents>

        api.MapGet("/catalog", () => TypedResults.Ok(CommerceDirectory.Catalog.OrderBy(p => p.Sku).ToArray()))
            .WithName("GetCatalog")
            .WithTags("Orders")
            .WithSummary("List the products that checkout accepts");

        // <snippet:AspNetCore.MapAuthorize>
        api.MapPost("/payments/authorize", Authorize)
            .WithName("AuthorizePayment")
            .WithTags("Payments")
            .WithSummary("Authorize a payment; the response body is a C# union")
            .WithDescription("Request 'method' is union PaymentMethod(Card, BankTransfer, Wallet); the 200 body is union PaymentOutcome(Approved, Declined, RequiresAction).")
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        // </snippet:AspNetCore.MapAuthorize>

        api.MapGet("/errors/throw", ThrowForDemo)
            .WithName("ThrowUnhandled")
            .WithTags("Errors")
            .WithSummary("Throws on purpose to show the problem+json 500 response")
            .ProducesProblem(StatusCodes.Status500InternalServerError);

        return api;
    }

    private static async Task<Results<Created<OrderView>, ValidationProblem, ProblemHttpResult>> CheckoutAsync(
        CheckoutRequest request, CheckoutService checkout, CancellationToken cancellationToken)
    {
        var result = await checkout.PlaceOrderAsync(request.CustomerId!, request.Currency!,
            request.Lines!.Select(l => (l.Sku!, l.Quantity)), request.CouponCode, cancellationToken);
        return ToHttpResult(result);
    }

    internal static Results<Created<OrderView>, ValidationProblem, ProblemHttpResult> ToHttpResult(PlaceOrderResult result) => result switch
    {
        OrderView order => TypedResults.Created($"/api/orders/{order.OrderId}", order),
        StockConflict c => ApiProblems.Conflict($"Only {c.Available} unit(s) of {c.Sku} are in stock; {c.Requested} requested.", "insufficient_stock",
            new Dictionary<string, object?> { ["sku"] = c.Sku, ["available"] = c.Available, ["requested"] = c.Requested }),
        null => throw new InvalidOperationException("PlaceOrderAsync returned an empty result."),
    };

    private static Results<Ok<OrderView>, ProblemHttpResult> GetOrder(string orderId, OrderStore orders) =>
        orders.Find(orderId) is { } order ? TypedResults.Ok(order) : ApiProblems.NotFound($"Order '{orderId}' does not exist.");

    private static Results<ServerSentEventsResult<OrderEvent>, ProblemHttpResult> OrderEvents(
        string orderId, OrderStore orders, TimeProvider time, CancellationToken cancellationToken) =>
        orders.Find(orderId) is { } order
            ? TypedResults.ServerSentEvents(OrderTimeline(order, time, cancellationToken))
            : ApiProblems.NotFound($"Order '{orderId}' does not exist.");

    private static async IAsyncEnumerable<SseItem<OrderEvent>> OrderTimeline(
        OrderView order, TimeProvider time, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        string[] stages = order.Status == OrderStatus.Paid ? ["placed", "paid", "packed", "shipped"] : ["placed", "awaiting_payment"];
        for (var i = 0; i < stages.Length; i++)
        {
            if (i > 0) await Task.Delay(TimeSpan.FromMilliseconds(150), time, cancellationToken);
            yield return new SseItem<OrderEvent>(new OrderEvent(order.OrderId, stages[i], i + 1, time.GetUtcNow()), "order-stage") { EventId = $"{order.OrderId}-{i + 1}" };
        }
    }

    // <snippet:AspNetCore.AuthorizeHandler>
    private static Results<Ok<PaymentOutcome>, ValidationProblem, ProblemHttpResult> Authorize(
        PaymentRequest request, OrderStore orders, PaymentProcessor processor)
    {
        if (request.Method.Value is null)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["Method"] = ["A card, bankTransfer or wallet payment method is required."] });

        var order = orders.Find(request.OrderId!);
        if (order is null) return ApiProblems.NotFound($"Order '{request.OrderId}' does not exist.");
        if (order.Status == OrderStatus.Paid) return ApiProblems.Conflict($"Order {order.OrderId} is already paid.", "order_already_paid");
        if (order.Total != request.Amount || !string.Equals(order.Currency, request.Currency, StringComparison.Ordinal))
            return ApiProblems.Unprocessable($"Amount {request.Amount} {request.Currency} does not match the order total {order.Total} {order.Currency}.",
                "amount_mismatch", new Dictionary<string, object?> { ["expectedAmount"] = order.Total, ["expectedCurrency"] = order.Currency });

        return TypedResults.Ok(processor.Authorize(request));
    }
    // </snippet:AspNetCore.AuthorizeHandler>

    private static IResult ThrowForDemo() =>
        throw new InvalidOperationException("Simulated failure: the ledger service did not respond.");
}
