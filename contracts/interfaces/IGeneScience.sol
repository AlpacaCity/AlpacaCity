// SPDX-License-Identifier: MIT

pragma solidity =0.6.12;

interface IGeneScience {
    function isAlpacaGeneScience() external pure returns (bool);

    /**
     * @dev given genes of alpaca 1 & 2, return a genetic combination
     * @param genes1 genes of matron
     * @param genes2 genes of sire
     * @param generation child generation
     * @param targetBlock target block child is intended to be born
     * @return gene child gene
     * @return energy energy associated with the gene
     * @return generationFactor buffs child energy, higher the generation larger the generationFactor
     *   energy = gene energy * generationFactor
     */
    function mixGenes(
        uint256 genes1,
        uint256 genes2,
        uint256 generation,
        uint256 targetBlock
    )
        external
        view
        returns (
            uint256 gene,
            uint256 energy,
            uint256 generationFactor
        );
}
