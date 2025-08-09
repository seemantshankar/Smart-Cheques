import hre from "hardhat";
const { ethers } = hre;

async function main() {
  // Deploy the debug contract
  const DebugEncoder = await ethers.getContractFactory("DebugEncoder");
  const debugEncoder = await DebugEncoder.deploy();
  await debugEncoder.waitForDeployment();
  
  // Test data
  const transactions = [ethers.toUtf8Bytes("tx1")];
  const receipts = [ethers.toUtf8Bytes("receipt1")];
  const merkleProofs = [ethers.toUtf8Bytes("proof1")];
  
  // Get Solidity encoding
  const solidityEncoded = await debugEncoder.justEncode(transactions, receipts, merkleProofs);
  const solidityHash = await debugEncoder.encodeAndHash(transactions, receipts, merkleProofs);
  
  // Get Ethers encoding
  const ethersEncoded = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes[]", "bytes[]"], [transactions, receipts, merkleProofs]);
  const ethersHash = ethers.keccak256(ethersEncoded);
  
  console.log("Solidity encoded:", solidityEncoded);
  console.log("Ethers encoded:  ", ethersEncoded);
  console.log("Encodings match: ", solidityEncoded === ethersEncoded);
  console.log("");
  console.log("Solidity hash:", solidityHash);
  console.log("Ethers hash:  ", ethersHash);
  console.log("Hashes match: ", solidityHash === ethersHash);
}

main().catch(console.error);