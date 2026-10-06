namespace BoardFlow.Data;

/// <summary>
/// A database operation failed. <see cref="Exception.Message"/> is written for the user; the inner
/// exception (already logged) carries the technical detail.
/// </summary>
public sealed class PersistenceException(string message, Exception? innerException = null)
    : Exception(message, innerException);

/// <summary>Thrown when an entity that an operation needs no longer exists.</summary>
public sealed class NotFoundException(string message) : Exception(message);
