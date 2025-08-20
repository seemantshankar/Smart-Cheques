import { ethers } from "hardhat";

async function main() {
  const timelockAddr = process.env.TIMELOCK_ADDRESS as string;
  const governorAddr = process.env.GOVERNOR_ADDRESS as string;
  const executorAddr = process.env.TIMELOCK_EXECUTOR as string; // multisig or zero
  if (!timelockAddr || !governorAddr || !executorAddr) throw new Error("Missing env: TIMELOCK_ADDRESS, GOVERNOR_ADDRESS, TIMELOCK_EXECUTOR");
  const timelock = await ethers.getContractAt("SmartChequeTimelockController", timelockAddr);
  await (await timelock.grantRole(await timelock.PROPOSER_ROLE(), governorAddr)).wait();
  await (await timelock.grantRole(await timelock.EXECUTOR_ROLE(), executorAddr)).wait();
  console.log("Assigned proposer and executor roles on timelock.");
}

main().catch((e) => { console.error(e); process.exit(1); });


