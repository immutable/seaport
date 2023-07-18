/* eslint-disable camelcase */
import { solidityPack, toUtf8Bytes } from "ethers/lib/utils";
import { deployments, getNamedAccounts, getUnnamedAccounts } from "hardhat";

import {
  SignedZoneController__factory,
  SignedZone__factory,
} from "../../typechain-types";

import { setupUser, setupUsers } from "./users";

import type { SignedZone, SignedZoneController } from "../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export interface Contracts {
  Controller: SignedZoneController;
  Breakwater: SignedZone;
}

export interface User extends Contracts {
  address: string;
  signer: SignerWithAddress;
}

export const setupContracts = deployments.createFixture(async ({ ethers }) => {
  const { deployer } = await getNamedAccounts();
  await deployments.fixture(["Deployment"]);
  const signedZoneController = await deployments.get("SignedZoneController");
  const signer = (await ethers.getSigners())[0];
  const signedZoneControllerContract =
    await SignedZoneController__factory.connect(
      signedZoneController.address,
      signer
    );

  const zoneAddress = await signedZoneControllerContract.getZone(
    ZONE_ID(deployer)
  );
  const breakwaterContract = await SignedZone__factory.connect(
    zoneAddress,
    signer
  );
  const contracts: Contracts = {
    Controller: signedZoneControllerContract,
    Breakwater: breakwaterContract,
  };

  const users: User[] = await setupUsers(await getUnnamedAccounts(), contracts);

  return {
    contracts,
    deployer: <User>await setupUser(deployer, contracts),
    users,
  };
});

export const ZONE_ID = (deployer: string) =>
  padRightTo32Bytes(
    solidityPack(["address", "bytes"], [deployer, toUtf8Bytes("SignedZone")])
  );

function padRightTo32Bytes(value: string) {
  if (value.length > 66) throw Error("Value too large");
  return value.padEnd(66, "0");
}
