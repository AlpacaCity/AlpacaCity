// SPDX-License-Identifier: MIT

pragma solidity =0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/IGeneScience.sol";
import "../interfaces/ICryptoAlpacaEnergyListener.sol";
import "./AlpacaBreed.sol";

contract AlpacaOperator is AlpacaBreed {
    using Address for address;

    address public operator;

    /*
     * bytes4(keccak256('onCryptoAlpacaEnergyChanged(uint256,uint256,uint256)')) == 0x5a864e1c
     */
    bytes4
        private constant _INTERFACE_ID_CRYPTO_ALPACA_ENERGY_LISTENER = 0x5a864e1c;

    /* ========== EVENTS ========== */

    /**
     * @dev Event for when alpaca's energy changed from `fromEnergy`
     */
    event EnergyChanged(
        uint256 indexed id,
        uint256 oldEnergy,
        uint256 newEnergy
    );

    /* ========== OPERATOR ONLY FUNCTION ========== */

    function updateAlpacaEnergy(
        address _owner,
        uint256 _id,
        uint32 _newEnergy
    ) external onlyOperator nonReentrant {
        require(_newEnergy > 0, "CryptoAlpaca: invalid energy");

        require(
            isOwnerOf(_owner, _id),
            "CryptoAlpaca: alpaca does not belongs to owner"
        );

        Alpaca storage thisAlpaca = alpacas[_id];
        uint32 oldEnergy = thisAlpaca.energy;
        thisAlpaca.energy = _newEnergy;

        emit EnergyChanged(_id, oldEnergy, _newEnergy);
        _doSafeEnergyChangedAcceptanceCheck(_owner, _id, oldEnergy, _newEnergy);
    }

    /**
     * @dev Transfers operator role to different address
     * Can only be called by the current operator.
     */
    function transferOperator(address _newOperator) external onlyOperator {
        require(
            _newOperator != address(0),
            "CryptoAlpaca: new operator is the zero address"
        );
        operator = _newOperator;
    }

    /* ========== MODIFIERS ========== */

    /**
     * @dev Throws if called by any account other than operator.
     */
    modifier onlyOperator() {
        require(
            operator == _msgSender(),
            "CryptoAlpaca: caller is not the operator"
        );
        _;
    }

    /* =========== PRIVATE ========= */

    function _doSafeEnergyChangedAcceptanceCheck(
        address _to,
        uint256 _id,
        uint256 _oldEnergy,
        uint256 _newEnergy
    ) private {
        if (_to.isContract()) {
            if (
                IERC165(_to).supportsInterface(
                    _INTERFACE_ID_CRYPTO_ALPACA_ENERGY_LISTENER
                )
            ) {
                ICryptoAlpacaEnergyListener(_to).onCryptoAlpacaEnergyChanged(
                    _id,
                    _oldEnergy,
                    _newEnergy
                );
            }
        }
    }
}
