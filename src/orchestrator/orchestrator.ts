import {
  CreateLogTable,
  PARACHAIN_NOT_FOUND,
  POLKADOT_NOT_FOUND,
  POLKADOT_NOT_FOUND_DESCRIPTION,
  askQuestion,
  decorators,
  filterConsole,
  generateNamespace,
  getSha256,
  loadTypeDef,
  makeDir,
  series,
  setSilent,
  sleep,
} from "../utils";
import fs from "fs";
import tmp from "tmp-promise";
import {
  addBootNodes,
  addParachainToGenesis,
  customizePlainRelayChain,
  readAndParseChainSpec,
} from "./chainSpec";
import {
  generateBootnodeSpec,
  generateNetworkSpec,
  zombieWrapperPath,
} from "./configGenerator";
import {
  GENESIS_STATE_FILENAME,
  GENESIS_WASM_FILENAME,
  TOKEN_PLACEHOLDER,
  ZOMBIE_WRAPPER,
} from "./constants";
import { registerParachain } from "./jsapi-helpers";
import { Network, Scope } from "./network";
import { generateParachainFiles } from "./paras";
import { getProvider } from "./providers/";
import {
  ComputedNetwork,
  LaunchConfig,
  Node,
  Parachain,
  fileMap,
} from "./types";

import { spawnIntrospector } from "./network-helpers/instrospector";
import { setTracingCollatorConfig } from "./network-helpers/tracing-collator";
import { nodeChecker, verifyNodes } from "./network-helpers/verifier";
import { Client } from "./providers/client";
import { spawnNode } from "./spawner";
import { setSubstrateCliArgsVersion } from "./substrateCliArgsHelper";
import { promises as fsPromises } from "fs";

const debug = require("debug")("zombie");

// Hide some warning messages that are coming from Polkadot JS API.
// TODO: Make configurable.
filterConsole([
  `code: '1006' reason: 'connection failed'`,
  `API-WS: disconnected`,
]);

export interface OrcOptionsInterface {
  monitor?: boolean;
  spawnConcurrency?: number;
  inCI?: boolean;
  dir?: string;
  force?: boolean;
  silent?: boolean; // Mute logging output
  setGlobalNetwork?: (network: Network) => void;
}

export async function start(
  credentials: string,
  launchConfig: LaunchConfig,
  options?: OrcOptionsInterface,
) {
  // const opts = {
  //   ...{ monitor: false, spawnConcurrency: 1, inCI: false, silent: true },
  //   ...options,
  // };

  const opts = {"monitor":false,"spawnConcurrency":4,"inCI":false,"silent":false,"dir":`${process.cwd()}/tmp`,"force":false};

  setSilent(opts.silent);
  let network: Network | undefined;
  let cronInterval = undefined;

  try {
    // Parse and build Network definition
    const networkSpec: ComputedNetwork = await generateNetworkSpec(
      launchConfig,
    );

    // IFF there are network references in cmds we need to switch to concurrency 1
    if (TOKEN_PLACEHOLDER.test(JSON.stringify(networkSpec))) {
      debug(
        "Network definition use network references, switching concurrency to 1",
      );
      opts.spawnConcurrency = 1;
    }

    debug(JSON.stringify(networkSpec, null, 4));

    const { initClient, setupChainSpec, getChainSpecRaw } = getProvider(
      networkSpec.settings.provider,
    );

    // global timeout to spin the network
    const timeoutTimer = setTimeout(() => {
      if (network && !network.launched) {
        throw new Error(
          `GLOBAL TIMEOUT (${networkSpec.settings.timeout} secs) `,
        );
      }
    }, networkSpec.settings.timeout * 1000);

    // set namespace
    const randomBytes = 16;
    const namespace = `zombie-${generateNamespace(randomBytes)}`;

    // get user defined types
    const userDefinedTypes: any = loadTypeDef(networkSpec.types);

    // use provided dir (and make some validations) or create tmp directory to store needed files
    const tmpDir = { path: opts.dir }

    // If custom path is provided then create it
    if (opts.dir) {
      if (!fs.existsSync(opts.dir)) {
        fs.mkdirSync(opts.dir);
      } else if (!opts.force) {
        const response = await askQuestion(
          decorators.yellow(
            "Directory already exists; \nDo you want to continue? (y/N)",
          ),
        );
        if (response.toLowerCase() !== "y") {
          console.log("Exiting...");
          process.exit(1);
        }
      }
    }

    const localMagicFilepath = `${tmpDir.path}/finished.txt`;
    // Create MAGIC file to stop temp/init containers
    fs.openSync(localMagicFilepath, "w");

    // Define chain name and file name to use.
    const chainSpecFileName = `${networkSpec.relaychain.chain}.json`;
    const chainName = networkSpec.relaychain.chain;
    const chainSpecFullPath = `${tmpDir.path}/${chainSpecFileName}`;
    const chainSpecFullPathPlain = chainSpecFullPath.replace(
      ".json",
      "-plain.json",
    );

    const client: Client = initClient(credentials, namespace, tmpDir.path);
    
    if (networkSpec.settings.node_spawn_timeout)
      client.timeout = networkSpec.settings.node_spawn_timeout;
    network = new Network(client, namespace, tmpDir.path);
    if (options?.setGlobalNetwork) {
      options.setGlobalNetwork(network);
    }

    // validate access to cluster
    const isValid = await client.validateAccess();
    console.log(isValid)
    if (!isValid) {
      console.error(
        `\n\t\t ${decorators.reverse(
          decorators.red("⚠ Can not access"),
        )} ${decorators.magenta(
          networkSpec.settings.provider,
        )}, please check your config.`,
      );
      process.exit(1);
    }

    const zombieWrapperLocalPath = `${tmpDir.path}/${ZOMBIE_WRAPPER}`;
    const zombieWrapperContent = await fs.promises.readFile(zombieWrapperPath);
    await fs.promises.writeFile(
      zombieWrapperLocalPath,
      zombieWrapperContent
        .toString()
        .replace("{{REMOTE_DIR}}", client.remoteDir!),
      {
        mode: 0o755,
      },
    );

    // create namespace
    await client.createNamespace();

    // Set substrate client argument version, needed from breaking change.
    // see https://github.com/paritytech/substrate/pull/13384
    await setSubstrateCliArgsVersion(networkSpec, client);
    
    // create or copy relay chain spec
    await setupChainSpec(
      namespace,
      networkSpec.relaychain,
      chainName,
      chainSpecFullPathPlain,
    );

  } catch {

  }
}

export async function test(
  credentials: string,
  networkConfig: LaunchConfig,
  cb: (network: Network) => void,
) {
  let network: Network | undefined;
  try {
    await start(credentials, networkConfig, { force: true });
    // await cb(network);
  } catch (error) {
    console.log(
      `\n ${decorators.red("Error: ")} \t ${decorators.bright(error)}\n`,
    );
  } finally {
    if (network) {
      await network.dumpLogs();
      await network.stop();
    }
  }
}
