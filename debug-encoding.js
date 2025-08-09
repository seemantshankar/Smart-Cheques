import hre from "hardhat";
const { ethers } = hre;

async function main() {
  // Test data
  const transactions = [ethers.toUtf8Bytes("tx1")];
  const receipts = [ethers.toUtf8Bytes("receipt1")];
  const merkleProofs = [ethers.toUtf8Bytes("proof1")];
  
  // Ethers encoding
  const ethersEncoded = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]", "bytes[]", "bytes[]"], [transactions, receipts, merkleProofs]);
  const ethersHash = ethers.keccak256(ethersEncoded);
  
  console.log("Transactions:", transactions.map(t => ethers.hexlify(t)));
  console.log("Receipts:", receipts.map(r => ethers.hexlify(r)));
  console.log("MerkleProofs:", merkleProofs.map(p => ethers.hexlify(p)));
  console.log("Ethers encoded:", ethersEncoded);
  console.log("Ethers hash:", ethersHash);
}

main().catch(console.error);