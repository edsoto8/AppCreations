namespace BoardFlow.Core;

/// <summary>
/// Thrown when user input breaks a business rule. The message is written for the user and is shown as is.
/// </summary>
public sealed class ValidationException(string message) : Exception(message);
