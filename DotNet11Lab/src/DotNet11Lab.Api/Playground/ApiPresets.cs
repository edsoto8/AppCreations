namespace DotNet11Lab.Api.Playground;

/// <summary>A ready-made request for the API playground. <see cref="ExpectedStatus"/> is asserted by the tests.</summary>
public sealed record ApiPreset(
    string Id,
    string Group,
    string Title,
    string Explanation,
    string Method,
    string Path,
    string? Body,
    int ExpectedStatus);

/// <summary>The playground's sample requests. Each one exercises a different validation path, union case or error.</summary>
public static class ApiPresets
{
    private const string ValidCheckout = """
        {
          "customerId": "cus_1001",
          "currency": "EUR",
          "lines": [
            { "sku": "SKU-KEYBOARD", "quantity": 1 },
            { "sku": "SKU-CABLE", "quantity": 2 }
          ],
          "couponCode": "GOLD20",
          "shipTo": { "name": "Ada Lovelace", "country": "GB", "postalCode": "SW1A 1AA", "express": true }
        }
        """;

    public static IReadOnlyList<ApiPreset> All { get; } =
    [
        new("checkout-valid", "Validation", "Valid checkout",
            "Every sync attribute, async attribute ([KnownCustomer], [ValidCoupon], [KnownSku] per line) and the async cross-field rule pass. 201 Created with a Location header.",
            "POST", "/api/checkout", ValidCheckout, 201),

        new("checkout-sync-invalid", "Validation", "Sync attributes fail",
            "Classic attributes: lowercase currency, quantity 0, one-letter name. Reported for nested objects and collection items (Lines[0].Quantity, ShipTo.Name).",
            "POST", "/api/checkout", """
            {
              "customerId": "cus_1001",
              "currency": "eur",
              "lines": [ { "sku": "SKU-MOUSE", "quantity": 0 } ],
              "shipTo": { "name": "A", "country": "GB", "postalCode": "SW1A 1AA" }
            }
            """, 400),

        new("checkout-async-invalid", "Validation", "Async attributes fail",
            "Unknown customer, expired coupon and an unknown SKU. Each needs an awaited lookup; the lookups run during validation, before the handler.",
            "POST", "/api/checkout", """
            {
              "customerId": "cus_9999",
              "currency": "EUR",
              "lines": [ { "sku": "SKU-MOUSE", "quantity": 1 }, { "sku": "SKU-TOASTER", "quantity": 1 } ],
              "couponCode": "EXPIRED24",
              "shipTo": { "name": "Nobody", "country": "GB", "postalCode": "SW1A 1AA" }
            }
            """, 400),

        new("checkout-cross-field-invalid", "Validation", "Async cross-field rule fails",
            "Each field is valid on its own, but WELCOME10 is for first orders and cus_1001 has 14. Reported by IAsyncValidatableObject.ValidateAsync.",
            "POST", "/api/checkout", """
            {
              "customerId": "cus_1001",
              "currency": "EUR",
              "lines": [ { "sku": "SKU-MOUSE", "quantity": 1 } ],
              "couponCode": "WELCOME10",
              "shipTo": { "name": "Ada Lovelace", "country": "GB", "postalCode": "SW1A 1AA" }
            }
            """, 400),

        new("checkout-v10style-invalid", "Validation", ".NET 10 style: same request, manual validation",
            "The async-invalid request sent to /api/v10style/checkout, which validates by hand in the handler. Same 400 body, many more lines of code.",
            "POST", "/api/v10style/checkout", """
            {
              "customerId": "cus_9999",
              "currency": "EUR",
              "lines": [ { "sku": "SKU-MOUSE", "quantity": 1 }, { "sku": "SKU-TOASTER", "quantity": 1 } ],
              "couponCode": "EXPIRED24",
              "shipTo": { "name": "Nobody", "country": "GB", "postalCode": "SW1A 1AA" }
            }
            """, 400),

        new("checkout-stock-conflict", "Errors", "Business conflict (409)",
            "Valid request, but only 3 monitors are in stock. ProblemDetails with a machine-readable code and extension members.",
            "POST", "/api/checkout", """
            {
              "customerId": "cus_1002",
              "currency": "USD",
              "lines": [ { "sku": "SKU-MONITOR", "quantity": 5 } ],
              "shipTo": { "name": "Grace Hopper", "country": "US", "postalCode": "10001" }
            }
            """, 409),

        new("payment-approved", "Unions", "Union case: PaymentApproved",
            "method is a CardPayment (the structural classifier matched cardNumber/expiry/cvc). The 200 body is the PaymentApproved case, no wrapper or $type.",
            "POST", "/api/payments/authorize", """
            {
              "orderId": "ord_1001",
              "amount": 128.50,
              "currency": "EUR",
              "method": { "cardNumber": "4242424242424242", "expiryMonth": 12, "expiryYear": 2030, "cvc": "123" }
            }
            """, 200),

        new("payment-declined", "Unions", "Union case: PaymentDeclined",
            "Card ending in 0002 is declined: same endpoint, same status, a different JSON shape (declineCode, reason, retryable).",
            "POST", "/api/payments/authorize", """
            {
              "orderId": "ord_1001",
              "amount": 128.50,
              "currency": "EUR",
              "method": { "cardNumber": "4000000000000002", "expiryMonth": 12, "expiryYear": 2030, "cvc": "123" }
            }
            """, 200),

        new("payment-requires-action", "Unions", "Union case: PaymentRequiresAction",
            "method is a BankTransferPayment (iban/accountHolder). The outcome is the third shape: actionType, redirectUrl, expiresAt.",
            "POST", "/api/payments/authorize", """
            {
              "orderId": "ord_1001",
              "amount": 128.50,
              "currency": "EUR",
              "method": { "iban": "GB33BUKB20201555555555", "accountHolder": "Ada Lovelace" }
            }
            """, 200),

        new("payment-unclassifiable", "Unions", "Union in the body matches no case",
            "{ \"paypalEmail\": ... } fits none of Card, BankTransfer or Wallet, so the structural classifier finds no case and binding fails with 400.",
            "POST", "/api/payments/authorize", """
            {
              "orderId": "ord_1001",
              "amount": 128.50,
              "currency": "EUR",
              "method": { "paypalEmail": "ada@example.com" }
            }
            """, 400),

        new("payment-already-paid", "Errors", "Already paid (409)",
            "ord_1002 is paid. A state conflict is a 409 problem with code order_already_paid.",
            "POST", "/api/payments/authorize", """
            {
              "orderId": "ord_1002",
              "amount": 249.00,
              "currency": "USD",
              "method": { "walletProvider": "applepay", "walletToken": "tok_visa" }
            }
            """, 409),

        new("payment-amount-mismatch", "Errors", "Amount mismatch (422)",
            "Well-formed and valid, but semantically wrong: the amount differs from the order total. 422 with the expected values as extensions.",
            "POST", "/api/payments/authorize", """
            {
              "orderId": "ord_1001",
              "amount": 100.00,
              "currency": "EUR",
              "method": { "walletProvider": "googlepay", "walletToken": "tok_visa" }
            }
            """, 422),

        new("order-found", "Errors", "Get an order (200)",
            "A seeded pending order.", "GET", "/api/orders/ord_1001", null, 200),

        new("order-not-found", "Errors", "Unknown order (404)",
            "404 problem+json with instance and traceId.", "GET", "/api/orders/ord_404", null, 404),

        new("unhandled-exception", "Errors", "Unhandled exception (500)",
            "The handler throws. The /api exception filter logs it and answers problem+json with a traceId; no stack trace leaks.",
            "GET", "/api/errors/throw", null, 500),

        new("order-events", "OpenAPI", "Server-Sent Events stream",
            "text/event-stream of the order timeline. OpenAPI 3.2 describes each event with itemSchema; the 3.1 document can only use an x- extension.",
            "GET", "/api/orders/ord_1002/events", null, 200),
    ];

    public static ApiPreset Get(string id) =>
        All.FirstOrDefault(p => p.Id == id) ?? throw new KeyNotFoundException($"Unknown preset '{id}'.");
}
