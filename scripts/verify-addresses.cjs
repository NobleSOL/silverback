const hre = require("hardhat");

async function main() {
  console.log("Checking contract addresses...\n");

  // Check address 1: 0x342d3879EbE201Db0966B595650c6614390857fa
  console.log("=== 0x342d3879EbE201Db0966B595650c6614390857fa ===");
  try {
    // Try factory interface
    const factory1 = await hre.ethers.getContractAt(
      ["function allPairsLength() external view returns (uint256)"],
      "0x342d3879EbE201Db0966B595650c6614390857fa"
    );
    const pairCount = await factory1.allPairsLength();
    console.log("✅ Has allPairsLength() -> This is a FACTORY");
    console.log("   Pairs:", pairCount.toString());
  } catch (e) {
    console.log("❌ No allPairsLength() - not a factory");
  }

  try {
    // Try router interface
    const router1 = await hre.ethers.getContractAt(
      ["function factory() external view returns (address)"],
      "0x342d3879EbE201Db0966B595650c6614390857fa"
    );
    const factoryAddr = await router1.factory();
    console.log("✅ Has factory() -> This is a ROUTER");
    console.log("   Factory:", factoryAddr);
  } catch (e) {
    console.log("❌ No factory() - not a router");
  }
  console.log();

  // Check address 2: 0xC744F497c2D580Ce19E248380B8379b3CA925A26
  console.log("=== 0xC744F497c2D580Ce19E248380B8379b3CA925A26 ===");
  try {
    const factory2 = await hre.ethers.getContractAt(
      ["function allPairsLength() external view returns (uint256)"],
      "0xC744F497c2D580Ce19E248380B8379b3CA925A26"
    );
    const pairCount = await factory2.allPairsLength();
    console.log("✅ Has allPairsLength() -> This is a FACTORY");
    console.log("   Pairs:", pairCount.toString());
  } catch (e) {
    console.log("❌ No allPairsLength() - not a factory");
  }

  try {
    const router2 = await hre.ethers.getContractAt(
      ["function factory() external view returns (address)"],
      "0xC744F497c2D580Ce19E248380B8379b3CA925A26"
    );
    const factoryAddr = await router2.factory();
    console.log("✅ Has factory() -> This is a ROUTER");
    console.log("   Factory:", factoryAddr);
  } catch (e) {
    console.log("❌ No factory() - not a router");
  }
  console.log();

  // Check the old addresses I was using
  console.log("=== 0x099869678bCCc5514e870e7d5A8FacF0E7cFF877 (OLD?) ===");
  try {
    const factory3 = await hre.ethers.getContractAt(
      ["function allPairsLength() external view returns (uint256)"],
      "0x099869678bCCc5514e870e7d5A8FacF0E7cFF877"
    );
    const pairCount = await factory3.allPairsLength();
    console.log("✅ Has allPairsLength() -> This is a FACTORY");
    console.log("   Pairs:", pairCount.toString());
  } catch (e) {
    console.log("❌ No allPairsLength() - not a factory");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
