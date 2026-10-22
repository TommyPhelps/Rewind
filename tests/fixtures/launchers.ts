// Launcher data shaped like what Epic (.item manifests), Ubisoft Connect and Rockstar (registry
// values) keep on a Windows PC. Titles and ids are representative examples, used by the tests
// and the development preview; nothing here comes from a real PC.
import type { RawLauncherScan } from "../../src/launchers/scan.ts";

const epicItem = (o: Record<string, unknown>) =>
  JSON.stringify({
    FormatVersion: 0,
    bIsIncompleteInstall: false,
    LaunchCommand: "",
    bIsApplication: true,
    bIsExecutable: true,
    bRequiresAuth: true,
    bCanRunOffline: true,
    AppCategories: ["public", "games", "applications"],
    ...o,
  });

export const FAKE_LAUNCHERS: RawLauncherScan = {
  epic: {
    detected: true,
    manifestsDir: "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests",
    manifests: [
      epicItem({ DisplayName: "Hades", AppName: "Min", CatalogNamespace: "min", CatalogItemId: "fb39bac8278a4126989f0fe12e7353af", InstallLocation: "D:\\Epic Games\\Hades", LaunchExecutable: "x64\\Hades.exe", MainGameAppName: "Min" }),
      epicItem({ DisplayName: "The Elder Scrolls V: Skyrim Special Edition", AppName: "ac82db5035584c7f8a2c548d98c86b2c", CatalogNamespace: "ac82db5035584c7f8a2c548d98c86b2c", CatalogItemId: "c8738a4d1ead40368eab9688b3c7d737", InstallLocation: "D:\\Epic Games\\SkyrimSE", MainGameAppName: "ac82db5035584c7f8a2c548d98c86b2c" }),
      epicItem({ DisplayName: "STAR WARS™ Knights of the Old Republic™", AppName: "kotor1", CatalogNamespace: "nsKotor", CatalogItemId: "itemKotor", InstallLocation: "D:\\Epic Games\\KOTOR" }),
      // DLC: points at its main game, so it's not a separate game.
      epicItem({ DisplayName: "Hades - Soundtrack", AppName: "MinDLC", CatalogNamespace: "min", CatalogItemId: "dlc1", MainGameAppName: "Min" }),
      // A half-finished install.
      epicItem({ DisplayName: "Alan Wake 2", AppName: "Dodo", CatalogNamespace: "dodo", CatalogItemId: "i2", bIsIncompleteInstall: true }),
      // Not a game.
      epicItem({ DisplayName: "Unreal Engine", AppName: "UE_5.4", CatalogNamespace: "ue", CatalogItemId: "ue54", AppCategories: ["engines", "applications"] }),
      "{ this is not json",
    ],
    error: null,
  },
  ubisoft: {
    detected: true,
    launcherDir: "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\",
    installs: [
      { id: "5059", installDir: "C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games/Assassin's Creed Valhalla/" },
      { id: "635", installDir: "C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games/Far Cry 3/" },
    ],
    uninstall: [
      { key: "Uplay Install 5059", displayName: "Assassin's Creed® Valhalla", installLocation: "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\Assassin's Creed Valhalla", publisher: "Ubisoft" },
      { key: "Uplay", displayName: "Ubisoft Connect", installLocation: "", publisher: "Ubisoft" },
    ],
    error: null,
  },
  rockstar: {
    detected: true,
    launcherDir: "C:\\Program Files\\Rockstar Games\\Launcher",
    games: [{ key: "Red Dead Redemption 2", installFolder: "D:\\Rockstar Games\\Red Dead Redemption 2" }],
    uninstall: [
      { key: "{5EFC6C07-6B87-43FC-9524-F9E967241741}", displayName: "Red Dead Redemption 2", installLocation: "D:\\Rockstar Games\\Red Dead Redemption 2", publisher: "Rockstar Games" },
      { key: "Rockstar Games Launcher", displayName: "Rockstar Games Launcher", installLocation: "", publisher: "Rockstar Games" },
      { key: "Rockstar Games Social Club", displayName: "Rockstar Games Social Club", installLocation: "", publisher: "Rockstar Games" },
    ],
    error: null,
  },
};
