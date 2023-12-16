var builder = DistributedApplication.CreateBuilder(args);

var apiservice = builder.AddProject<Projects.YGOBanlist_ApiService>("apiservice");

builder.AddProject<Projects.YGOBanlist_Web>("webfrontend")
    .WithReference(apiservice);

builder.Build().Run();
