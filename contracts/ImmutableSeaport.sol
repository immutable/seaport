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
import { BasicOrderType, OrderType } from "./lib/ConsiderationEnums.sol";
import {
    Ownable
} from "@openzeppelin/contracts/access/Ownable.sol";

contract ImmutableSeaport is Consideration, Ownable {
    // Mapping to store valid ImmutableZones - this allows for multiple Zones
    // to be active at the same time, and can be expired or added on demand.
    mapping(address => bool) public immutableZones;

    // error OrderNotRestricted();
    // error InvalidZone(address zone);
    /**
     * @notice Derive and set hashes, reference chainId, and associated domain
     *         separator during deployment.
     *
     * @param conduitController A contract that deploys conduits, or proxies
     *                          that may optionally be used to transfer approved
     *                          ERC20/721/1155 tokens.
     */
    constructor(address conduitController) Consideration(conduitController) Ownable() {}

    // Mark a zone address as active/valid
    function addImmutableZone(
        address zone
    ) external onlyOwner() {
        immutableZones[zone] = true;
    }

    // Mark a zone address as inactive/invalid
    function removeImmutableZone(
        address zone
    ) external onlyOwner() {
        immutableZones[zone] = false;
    }

    /**
     * @dev Internal pure function to retrieve and return the name of this
     *      contract.
     *
     * @return The name of this contract.
     */
    function _name() internal pure override returns (string memory) {
        // Return the name of the contract.
        return "ImmutableSeaport";
    }

    /**
     * @dev Internal pure function to retrieve the name of this contract as a
     *      string that will be used to derive the name hash in the constructor.
     *
     * @return The name of this contract as a string.
     */
    function _nameString() internal pure override returns (string memory) {
        // Return the name of the contract.
        return "ImmutableSeaport";
    }

    function fulfillAdvancedOrder(
        AdvancedOrder calldata advancedOrder,
        CriteriaResolver[] calldata criteriaResolvers,
        bytes32 fulfillerConduitKey,
        address recipient
    ) public payable override returns (bool fulfilled) {
        if (advancedOrder.parameters.orderType != OrderType.FULL_RESTRICTED && advancedOrder.parameters.orderType != OrderType.PARTIAL_RESTRICTED) {
            revert("Order not restricted");
        }
        if (!immutableZones[advancedOrder.parameters.zone]) {
            revert("InvalidZone");
        }
        return super.fulfillAdvancedOrder(
                advancedOrder,
                criteriaResolvers,
                fulfillerConduitKey,
                recipient
            );
    }

    function fulfillBasicOrder(
        BasicOrderParameters calldata parameters
    ) public payable override returns (bool fulfilled) {
        // All restricted orders are captured using this method
        if(uint(parameters.basicOrderType) % 4 != 2 && uint(parameters.basicOrderType) % 4 != 3) {
            revert("Order not restricted");

        }

        if (!immutableZones[parameters.zone]) {
            revert("InvalidZone");
        }
        return super.fulfillBasicOrder(parameters);
    }

    function fulfillBasicOrder_efficient_6GL6yc(
        BasicOrderParameters calldata parameters
    ) public payable override returns (bool fulfilled) {
        // All restricted orders are captured using this method
        if(uint(parameters.basicOrderType) % 4 != 2 && uint(parameters.basicOrderType) % 4 != 3) {
            revert("Order not restricted");

        }

        if (!immutableZones[parameters.zone]) {
            revert("InvalidZone");
        }
        return super.fulfillBasicOrder_efficient_6GL6yc(parameters);
    }

    function fulfillOrder(
        Order calldata order,
        bytes32 fulfillerConduitKey
    ) public payable override returns (bool fulfilled) {
        if (order.parameters.orderType != OrderType.FULL_RESTRICTED && order.parameters.orderType != OrderType.PARTIAL_RESTRICTED) {
            revert("Order not restricted");

        }
        if (!immutableZones[order.parameters.zone]) {
            revert("InvalidZone");
        }
        return super.fulfillOrder(order, fulfillerConduitKey);
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
        virtual
        returns (
            bool[] memory /* availableOrders */,
            Execution[] memory /* executions */
        )
    {
        for (uint256 i = 0; i < orders.length; i++) {
            Order memory order = orders[i];
            if (order.parameters.orderType != OrderType.FULL_RESTRICTED && order.parameters.orderType != OrderType.PARTIAL_RESTRICTED) {
                revert("Order not restricted");
            }
            if (!immutableZones[order.parameters.zone]) {
                revert("InvalidZone");
            }
        }
        return fulfillAvailableOrders(
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
        virtual
        returns (
            bool[] memory /* availableOrders */,
            Execution[] memory /* executions */
        )
    {
        for (uint256 i = 0; i < advancedOrders.length; i++) {
            AdvancedOrder memory advancedOrder = advancedOrders[i];
            if (advancedOrder.parameters.orderType != OrderType.FULL_RESTRICTED && advancedOrder.parameters.orderType != OrderType.PARTIAL_RESTRICTED) {
                revert("Order not restricted");
            }

            if (!immutableZones[advancedOrder.parameters.zone]) {
                revert("InvalidZone");
            }
        }

        return super.fulfillAvailableAdvancedOrders(
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
    ) public payable override virtual returns (Execution[] memory /* executions */) {
        for (uint256 i = 0; i < orders.length; i++) {
            Order memory order = orders[i];
            if (order.parameters.orderType != OrderType.FULL_RESTRICTED && order.parameters.orderType != OrderType.PARTIAL_RESTRICTED) {
                revert("Order not restricted");
            }
            if (!immutableZones[order.parameters.zone]) {
                revert("InvalidZone");
            }
        }
        return matchOrders(orders, fulfillments);
    }

    function matchAdvancedOrders(
        AdvancedOrder[] calldata advancedOrders,
        CriteriaResolver[] calldata criteriaResolvers,
        Fulfillment[] calldata fulfillments,
        address recipient
    ) public payable override virtual returns (Execution[] memory /* executions */) {
        for (uint256 i = 0; i < advancedOrders.length; i++) {
            AdvancedOrder memory advancedOrder = advancedOrders[i];
            if (advancedOrder.parameters.orderType != OrderType.FULL_RESTRICTED && advancedOrder.parameters.orderType != OrderType.PARTIAL_RESTRICTED) {
                revert("Order not restricted");
            }

            if (!immutableZones[advancedOrder.parameters.zone]) {
                revert("InvalidZone");
            }
        }
        return super.matchAdvancedOrders(advancedOrders, criteriaResolvers, fulfillments, recipient);
    }
}