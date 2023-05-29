import { randomBytes } from "crypto";
import hre from "hardhat";

async function main() {
  const seaportConduitControllerContractFactory =
    await hre.ethers.getContractFactory("ConduitController");
  const seaportConduitControllerContract =
    await seaportConduitControllerContractFactory.deploy();
  await seaportConduitControllerContract.deployed();

  const accounts = await hre.ethers.getSigners();

  // TODO: use ImmutableZone
  // const operatorAddress = ''
  // const seaportZoneControllerContractFactory = await hre.ethers.getContractFactory("ImmutableZoneController")

  const seaportZoneControllerContractFactory =
    await hre.ethers.getContractFactory("ImmutableZoneController");
  const seaportZoneControllerContract =
    await seaportZoneControllerContractFactory.deploy(accounts[0].address);
  await seaportZoneControllerContract.deployed();

  // Assign operator to seaport zone
  // await seaportZoneControllerContract.connect(accounts[0]).assignOperator(addresses.zone_address, operatorAddress)

  const seaportZoneContractTx = await seaportZoneControllerContract.createZone(
    randomBytes(32)
  );
  const seaportZoneContractResponse = await seaportZoneContractTx.wait(1);

  console.log(
    `Seaport Conduit Controller deployed to ${seaportConduitControllerContract.address}`
  );

  const seaportContractFactory = await hre.ethers.getContractFactory(
    "ImmutableSeaport"
  );
  const seaportContract = await seaportContractFactory.deploy(
    seaportConduitControllerContract.address
  );
  await seaportContract.deployed();

  const addresses = {
    seaport_address: seaportContract.address,
    zone_address: "",
  };
  // @ts-ignore
  for (const event of seaportZoneContractResponse.events) {
    if (event.event == "ZoneCreated") addresses.zone_address = event.args![0];
  }

  console.log(`contracts deployed to: ${JSON.stringify(addresses)}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
