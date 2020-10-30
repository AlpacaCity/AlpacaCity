// SPDX-License-Identifier: MIT

pragma solidity =0.6.12;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "./AlpacaBase.sol";

contract AlpacaToken is AlpacaBase, ERC1155("") {
    /* ========== EVENTS ========== */

    /**
     * @dev Emitted when single `alpacaId` alpaca with `gene` and `energy` is born
     */
    event BornSingle(uint256 indexed alpacaId, uint256 gene, uint256 energy);

    /**
     * @dev Equivalent to multiple {BornSingle} events
     */
    event BornBatch(uint256[] alpacaIds, uint256[] genes, uint256[] energy);

    /* ========== VIEWS ========== */

    /**
     * @dev Check if `_alpacaId` is owned by `_account`
     */
    function isOwnerOf(address _account, uint256 _alpacaId)
        public
        view
        returns (bool)
    {
        return balanceOf(_account, _alpacaId) == 1;
    }

    /* ========== OWNER MUTATIVE FUNCTION ========== */

    /**
     * @dev Allow contract owner to update URI to look up all alpaca metadata
     */
    function setURI(string memory _newuri) external onlyOwner {
        _setURI(_newuri);
    }

    /**
     * @dev Allow contract owner to create generation 0 alpaca with `_gene`,
     *   `_energy` and transfer to `owner`
     *
     * Requirements:
     *
     * - `_energy` must be less than or equal to MAX_GEN0_ENERGY
     */
    function createGen0Alpaca(
        uint256 _gene,
        uint256 _energy,
        address _owner
    ) external onlyOwner {
        address alpacaOwner = _owner;
        if (alpacaOwner == address(0)) {
            alpacaOwner = owner();
        }

        _createGen0Alpaca(_gene, _energy, alpacaOwner);
    }

    /**
     * @dev Equivalent to multiple {createGen0Alpaca} function
     *
     * Requirements:
     *
     * - all `_energies` must be less than or equal to MAX_GEN0_ENERGY
     */
    function createGen0AlpacaBatch(
        uint256[] memory _genes,
        uint256[] memory _energies,
        address _owner
    ) external onlyOwner {
        address alpacaOwner = _owner;
        if (alpacaOwner == address(0)) {
            alpacaOwner = owner();
        }

        _createGen0AlpacaBatch(_genes, _energies, _owner);
    }

    /* ========== INTERNAL ALPA GENERATION ========== */

    /**
     * @dev Create an alpaca egg. Egg's `gene` and `energy` will assigned to 0
     * initially and won't be determined until egg is cracked.
     */
    function _createEgg(
        uint256 _matronId,
        uint256 _sireId,
        uint256 _generation,
        uint256 _cooldownEndBlock,
        address _owner
    ) internal returns (uint256) {
        require(_matronId == uint256(uint32(_matronId)));
        require(_sireId == uint256(uint32(_sireId)));
        require(_generation == uint256(uint16(_generation)));

        Alpaca memory _alpaca = Alpaca({
            gene: 0,
            energy: 0,
            birthTime: uint64(now),
            hatchCostMultiplierEndBlock: 0,
            hatchingCostMultiplier: 1,
            matronId: uint32(_matronId),
            sireId: uint32(_sireId),
            cooldownEndBlock: uint64(_cooldownEndBlock),
            generation: uint16(_generation),
            generationFactor: 0,
            state: AlpacaGrowthState.EGG
        });

        alpacas.push(_alpaca);
        uint256 eggId = alpacas.length - 1;

        _mint(_owner, eggId, 1, "");

        return eggId;
    }

    /**
     * @dev Internal gen-0 alpaca creation function
     *
     * Requirements:
     *
     * - `_energy` must be less than or equal to MAX_GEN0_ENERGY
     */
    function _createGen0Alpaca(
        uint256 _gene,
        uint256 _energy,
        address _owner
    ) internal returns (uint256) {
        require(_energy <= MAX_GEN0_ENERGY, "CryptoAlpaca: invalid energy");

        Alpaca memory _alpaca = Alpaca({
            gene: _gene,
            energy: uint32(_energy),
            birthTime: uint64(now),
            hatchCostMultiplierEndBlock: 0,
            hatchingCostMultiplier: 1,
            matronId: 0,
            sireId: 0,
            cooldownEndBlock: 0,
            generation: 0,
            generationFactor: GEN0_GENERATION_FACTOR,
            state: AlpacaGrowthState.GROWN
        });

        alpacas.push(_alpaca);
        uint256 newAlpacaID = alpacas.length - 1;

        _mint(_owner, newAlpacaID, 1, "");

        // emit the born event
        emit BornSingle(newAlpacaID, _gene, _energy);

        return newAlpacaID;
    }

    /**
     * @dev Internal gen-0 alpaca batch creation function
     *
     * Requirements:
     *
     * - all `_energies` must be less than or equal to MAX_GEN0_ENERGY
     */
    function _createGen0AlpacaBatch(
        uint256[] memory _genes,
        uint256[] memory _energies,
        address _owner
    ) internal returns (uint256[] memory) {
        require(
            _genes.length > 0,
            "CryptoAlpaca: must pass at least one genes"
        );
        require(
            _genes.length == _energies.length,
            "CryptoAlpaca: genes and energy length mismatch"
        );

        uint256 alpacaIdStart = alpacas.length;
        uint256[] memory ids = new uint256[](_genes.length);
        uint256[] memory amount = new uint256[](_genes.length);

        for (uint256 i = 0; i < _genes.length; i++) {
            require(
                _energies[i] <= MAX_GEN0_ENERGY,
                "CryptoAlpaca: invalid energy"
            );

            Alpaca memory _alpaca = Alpaca({
                gene: _genes[i],
                energy: uint32(_energies[i]),
                birthTime: uint64(now),
                hatchCostMultiplierEndBlock: 0,
                hatchingCostMultiplier: 1,
                matronId: 0,
                sireId: 0,
                cooldownEndBlock: 0,
                generation: 0,
                generationFactor: GEN0_GENERATION_FACTOR,
                state: AlpacaGrowthState.GROWN
            });

            alpacas.push(_alpaca);
            ids[i] = alpacaIdStart + i;
            amount[i] = 1;
        }

        _mintBatch(_owner, ids, amount, "");

        emit BornBatch(ids, _genes, _energies);

        return ids;
    }
}
