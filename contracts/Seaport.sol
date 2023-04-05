// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { Consideration } from "./lib/Consideration.sol";
import {
    AdvancedOrder,
    BasicOrderParameters,
    CriteriaResolver,
    Execution,
    Fulfillment,
    FulfillmentComponent,
    Order,
    OrderComponents
} from "./lib/ConsiderationStructs.sol";
import { BasicOrderType } from "./lib/ConsiderationEnums.sol";
import {
    AccessControl
} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Seaport
 * @custom:version 1.4
 * @author 0age (0age.eth)
 * @custom:coauthor d1ll0n (d1ll0n.eth)
 * @custom:coauthor transmissions11 (t11s.eth)
 * @custom:coauthor James Wenzel (emo.eth)
 * @custom:contributor Kartik (slokh.eth)
 * @custom:contributor LeFevre (lefevre.eth)
 * @custom:contributor Joseph Schiarizzi (CupOJoseph.eth)
 * @custom:contributor Aspyn Palatnick (stuckinaboot.eth)
 * @custom:contributor Stephan Min (stephanm.eth)
 * @custom:contributor Ryan Ghods (ralxz.eth)
 * @custom:contributor Daniel Viau (snotrocket.eth)
 * @custom:contributor hack3r-0m (hack3r-0m.eth)
 * @custom:contributor Diego Estevez (antidiego.eth)
 * @custom:contributor Chomtana (chomtana.eth)
 * @custom:contributor Saw-mon and Natalie (sawmonandnatalie.eth)
 * @custom:contributor 0xBeans (0xBeans.eth)
 * @custom:contributor 0x4non (punkdev.eth)
 * @custom:contributor Laurence E. Day (norsefire.eth)
 * @custom:contributor vectorized.eth (vectorized.eth)
 * @custom:contributor karmacoma (karmacoma.eth)
 * @custom:contributor horsefacts (horsefacts.eth)
 * @custom:contributor UncarvedBlock (uncarvedblock.eth)
 * @custom:contributor Zoraiz Mahmood (zorz.eth)
 * @custom:contributor William Poulin (wpoulin.eth)
 * @custom:contributor Rajiv Patel-O'Connor (rajivpoc.eth)
 * @custom:contributor tserg (tserg.eth)
 * @custom:contributor cygaar (cygaar.eth)
 * @custom:contributor Meta0xNull (meta0xnull.eth)
 * @custom:contributor gpersoon (gpersoon.eth)
 * @custom:contributor Matt Solomon (msolomon.eth)
 * @custom:contributor Weikang Song (weikangs.eth)
 * @custom:contributor zer0dot (zer0dot.eth)
 * @custom:contributor Mudit Gupta (mudit.eth)
 * @custom:contributor leonardoalt (leoalt.eth)
 * @custom:contributor cmichel (cmichel.eth)
 * @custom:contributor PraneshASP (pranesh.eth)
 * @custom:contributor JasperAlexander (jasperalexander.eth)
 * @custom:contributor Ellahi (ellahi.eth)
 * @custom:contributor zaz (1zaz1.eth)
 * @custom:contributor berndartmueller (berndartmueller.eth)
 * @custom:contributor dmfxyz (dmfxyz.eth)
 * @custom:contributor daltoncoder (dontkillrobots.eth)
 * @custom:contributor 0xf4ce (0xf4ce.eth)
 * @custom:contributor phaze (phaze.eth)
 * @custom:contributor hrkrshnn (hrkrshnn.eth)
 * @custom:contributor axic (axic.eth)
 * @custom:contributor leastwood (leastwood.eth)
 * @custom:contributor 0xsanson (sanson.eth)
 * @custom:contributor blockdev (blockd3v.eth)
 * @custom:contributor fiveoutofnine (fiveoutofnine.eth)
 * @custom:contributor shuklaayush (shuklaayush.eth)
 * @custom:contributor dravee (dravee.eth)
 * @custom:contributor 0xPatissier
 * @custom:contributor pcaversaccio
 * @custom:contributor David Eiber
 * @custom:contributor csanuragjain
 * @custom:contributor sach1r0
 * @custom:contributor twojoy0
 * @custom:contributor ori_dabush
 * @custom:contributor Daniel Gelfand
 * @custom:contributor okkothejawa
 * @custom:contributor FlameHorizon
 * @custom:contributor vdrg
 * @custom:contributor dmitriia
 * @custom:contributor bokeh-eth
 * @custom:contributor asutorufos
 * @custom:contributor rfart(rfa)
 * @custom:contributor Riley Holterhus
 * @custom:contributor big-tech-sux
 * @notice Seaport is a generalized native token/ERC20/ERC721/ERC1155
 *         marketplace with lightweight methods for common routes as well as
 *         more flexible methods for composing advanced orders or groups of
 *         orders. Each order contains an arbitrary number of items that may be
 *         spent (the "offer") along with an arbitrary number of items that must
 *         be received back by the indicated recipients (the "consideration").
 */
contract Seaport is Consideration, AccessControl {
    // Mapping to store valid ImmutableZones - this allows for multiple Zones
    // to be active at the same time, and can be expired or added on demand.
    mapping(address => bool) public immutableZones;

    /**
     * @notice Derive and set hashes, reference chainId, and associated domain
     *         separator during deployment.
     *
     * @param conduitController A contract that deploys conduits, or proxies
     *                          that may optionally be used to transfer approved
     *                          ERC20/721/1155 tokens.
     */
    constructor(address conduitController) Consideration(conduitController) {
        // Set deployer account as default admin.
        // You could change this to be defined by a constructor arg, but
        // this also changes the Seaport constructor interface.
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // Mark a zone address as active/valid
    function addImmutableZone(
        address zone
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        immutableZones[zone] = true;
    }

    // Mark a zone address as inactive/invalid
    function removeImmutableZone(
        address zone
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        immutableZones[zone] = false;
    }

    // Convenience function to set multiple zone validity at once
    function setImmutableZones(
        address[] calldata zones,
        bool[] calldata valid
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            zones.length == valid.length,
            "ImmutableSeaport: zones and valid must be the same length"
        );
        for (uint256 i = 0; i < zones.length; ) {
            immutableZones[zones[i]] = valid[i];
            unchecked {
                i += 1;
            }
        }
    }

    // Override all external settlement functions and add checks on the
    // order type and zone.

    function fulfillBasicOrder(
        BasicOrderParameters calldata parameters
    ) public payable override returns (bool fulfilled) {
        // Check order type is restricted, see BasicOrderType enum.
        require(
            uint(parameters.basicOrderType) % 4 == 2 ||
                uint(parameters.basicOrderType) % 4 == 3,
            "ImmutableSeaport: order type must be restricted"
        );
        // Check that the zone is set to a valid ImmutableZone.
        require(
            immutableZones[parameters.zone],
            "ImmutableSeaport: order zone must be a valid ImmutableZone"
        );
        return super.fulfillBasicOrder(parameters);
    }

    function fulfillBasicOrder_efficient_6GL6yc(
        BasicOrderParameters calldata parameters
    ) public payable override returns (bool fulfilled) {
        // Check order type is restricted, see BasicOrderType enum.
        require(
            uint(parameters.basicOrderType) % 4 == 2 ||
                uint(parameters.basicOrderType) % 4 == 3,
            "ImmutableSeaport: order type must be restricted"
        );
        // Check that the zone is set to a valid ImmutableZone.
        require(
            immutableZones[parameters.zone],
            "ImmutableSeaport: order zone must be a valid ImmutableZone"
        );
        return super.fulfillBasicOrder(parameters);
    }

    function fulfillOrder(
        Order calldata order,
        bytes32 fulfillerConduitKey
    ) public payable override returns (bool fulfilled) {
        // Check order type is restricted, see BasicOrderType enum.
        require(
            uint(order.parameters.orderType) == 2 ||
                uint(order.parameters.orderType) == 3,
            "ImmutableSeaport: order type must be restricted"
        );
        // Check that the zone is set to a valid ImmutableZone.
        require(
            immutableZones[order.parameters.zone],
            "ImmutableSeaport: order zone must be a valid ImmutableZone"
        );
        return super.fulfillOrder(order, fulfillerConduitKey);
    }

    function fulfillAdvancedOrder(
        AdvancedOrder calldata advancedOrder,
        CriteriaResolver[] calldata criteriaResolvers,
        bytes32 fulfillerConduitKey,
        address recipient
    ) public payable override returns (bool fulfilled) {
        return
            super.fulfillAdvancedOrder(
                advancedOrder,
                criteriaResolvers,
                fulfillerConduitKey,
                recipient
            );
    }

    function fulfillAvailableOrders(
        Order[] calldata orders,
        FulfillmentComponent[][] calldata offerFulfillments,
        FulfillmentComponent[][] calldata considerationFulfillments,
        bytes32 fulfillerConduitKey,
        uint256 maximumFulfilled
    )
        public
        payable
        override
        returns (
            bool[] memory /* availableOrders */,
            Execution[] memory /* executions */
        )
    {
        return
            super.fulfillAvailableOrders(
                orders,
                offerFulfillments,
                considerationFulfillments,
                fulfillerConduitKey,
                maximumFulfilled
            );
    }

    function fulfillAvailableAdvancedOrders(
        AdvancedOrder[] calldata advancedOrders,
        CriteriaResolver[] calldata criteriaResolvers,
        FulfillmentComponent[][] calldata offerFulfillments,
        FulfillmentComponent[][] calldata considerationFulfillments,
        bytes32 fulfillerConduitKey,
        address recipient,
        uint256 maximumFulfilled
    )
        public
        payable
        override
        returns (
            bool[] memory /* availableOrders */,
            Execution[] memory /* executions */
        )
    {
        return
            super.fulfillAvailableAdvancedOrders(
                advancedOrders,
                criteriaResolvers,
                offerFulfillments,
                considerationFulfillments,
                fulfillerConduitKey,
                recipient,
                maximumFulfilled
            );
    }

    function matchOrders(
        Order[] calldata orders,
        Fulfillment[] calldata fulfillments
    ) public payable override returns (Execution[] memory /* executions */) {
        return super.matchOrders(orders, fulfillments);
    }

    function matchAdvancedOrders(
        AdvancedOrder[] calldata advancedOrders,
        CriteriaResolver[] calldata criteriaResolvers,
        Fulfillment[] calldata fulfillments,
        address recipient
    ) public payable override returns (Execution[] memory /* executions */) {
        return
            super.matchAdvancedOrders(
                advancedOrders,
                criteriaResolvers,
                fulfillments,
                recipient
            );
    }

    /**
     * @dev Internal pure function to retrieve and return the name of this
     *      contract.
     *
     * @return The name of this contract.
     */
    function _name() internal pure override returns (string memory) {
        // Return the name of the contract.
        assembly {
            mstore(0x20, 0x20)
            mstore(0x47, 0x07536561706f7274)
            return(0x20, 0x60)
        }
    }

    /**
     * @dev Internal pure function to retrieve the name of this contract as a
     *      string that will be used to derive the name hash in the constructor.
     *
     * @return The name of this contract as a string.
     */
    function _nameString() internal pure override returns (string memory) {
        // Return the name of the contract.
        // Changing the name of this contract will change the domain separator
        // used when signing orders.
        return "ImmutableSeaport";
    }
}
