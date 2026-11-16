/*  Optional: creates an empty database for local testing. Skip this script when you use an existing database.  */
IF DB_ID(N'NcrDispute') IS NULL
    CREATE DATABASE NcrDispute;
GO
