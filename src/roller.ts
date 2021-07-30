import {
    Conditional,
    ResultMapInterface,
    Roller,
    SectionCacheWithFile
} from "src/types";
import {
    Events,
    MarkdownRenderer,
    MetadataCache,
    Notice,
    TFile,
    Vault
} from "obsidian";
import { _checkCondition, _getRandomBetween, _insertIntoMap } from "./util";

export class DiceRoll implements Roller<number> {
    dice: string;
    modifiers: string[] = [];
    rolls: number;
    faces: { min: number; max: number };
    results: ResultMapInterface<number>;
    resultArray: number[];
    originalRoll: number[];
    modifiersAllowed: boolean = true;
    static: boolean = false;
    conditions: Conditional[];

    get text() {
        return `${this.result}`;
    }

    get result() {
        if (this.static) {
            return Number(this.dice);
        }
        const results = [...this.results].map(([, { usable, value }]) =>
            usable ? value : 0
        );
        return results.reduce((a, b) => a + b, 0);
    }
    get display() {
        if (this.static) {
            return `${this.result}`;
        }
        return `[${[...this.results]
            .map(
                ([, { modifiers, value }]) =>
                    `${value}${[...modifiers].join("")}`
            )
            .join(", ")}]`;
    }
    constructor(dice: string) {
        if (!/(\-?\d+)[dD]?(\d+|%|\[\d+,\s?\d+\])?/.test(dice)) {
            throw new Error("Non parseable dice string passed to DiceRoll.");
        }
        this.dice = dice.split(" ").join("");

        if (/^-?\d+$/.test(this.dice)) {
            this.static = true;
            this.modifiersAllowed = false;
        }
        let [, rolls, min = null, max = 1] = this.dice.match(
            /(\-?\d+)[dD]\[?(?:(-?\d+)\s?,)?\s?(-?\d+|%|F)\]?/
        ) || [, 1, null, 1];
        this.rolls = Number(rolls) || 1;
        if (Number(max) < 0 && !min) {
            min = -1;
        }
        if (max === "%") max = 100;
        if (max === "F") {
            max = 1;
            min = -1;
        }
        if (Number(max) < Number(min)) {
            [max, min] = [min, max];
        }

        this.faces = { max: max ? Number(max) : 1, min: min ? Number(min) : 1 };

        this.originalRoll = this.roll();
        this.results = new Map(
            [...this.originalRoll].map((n, i) => {
                return [i, { usable: true, value: n, modifiers: new Set() }];
            })
        );
    }
    keepLow(drop: number = 1) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        [...this.results]
            .sort((a, b) => a[1].value - b[1].value)
            .slice(drop - this.results.size)
            .forEach(([index]) => {
                const previous = this.results.get(index);
                previous.usable = false;
                previous.modifiers.add("d");
                this.results.set(index, { ...previous });
            });
    }
    keepHigh(drop: number = 1) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        [...this.results]
            .sort((a, b) => b[1].value - a[1].value)
            .slice(drop)
            .forEach(([index]) => {
                const previous = this.results.get(index);
                previous.usable = false;
                previous.modifiers.add("d");
                this.results.set(index, { ...previous });
            });
    }
    reroll(times: number, conditionals: Conditional[]) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        /**
         * Build Conditional
         */
        if (!conditionals.length) {
            conditionals.push({
                operator: "=",
                comparer: this.faces.min
            });
        }

        /**
         * Find values that pass the conditional.
         */
        let i = 0,
            toReroll = [...this.results].filter(([, { value }]) =>
                _checkCondition(value, conditionals)
            );
        while (
            i < times &&
            toReroll.filter(([, { value }]) =>
                _checkCondition(value, conditionals)
            ).length > 0
        ) {
            i++;
            toReroll.map(([, roll]) => {
                roll.modifiers.add("r");
                roll.value = _getRandomBetween(this.faces.min, this.faces.max);
            });
        }

        toReroll.forEach(([index, value]) => {
            this.results.set(index, value);
        });
    }
    explodeAndCombine(times: number, conditionals: Conditional[]) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }

        /**
         * Build Conditional
         */
        if (!conditionals.length) {
            conditionals.push({
                operator: "=",
                comparer: this.faces.max
            });
        }

        /**
         * Find values that pass the conditional
         */
        let i = 0,
            toExplode = [...this.results].filter(([, { value }]) =>
                _checkCondition(value, conditionals)
            );

        toExplode.forEach(([index, value]) => {
            let newRoll = _getRandomBetween(this.faces.min, this.faces.max);
            i++;
            value.modifiers.add("!");
            value.value += newRoll;
            this.results.set(index, value);
            while (i < times && _checkCondition(newRoll, conditionals)) {
                i++;
                newRoll = _getRandomBetween(this.faces.min, this.faces.max);
                value.value += newRoll;
                this.results.set(index, value);
            }
        });
    }
    explode(times: number, conditionals: Conditional[]) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }

        /**
         * Build Conditional
         */
        if (!conditionals.length) {
            conditionals.push({
                operator: "=",
                comparer: this.faces.max
            });
        }

        /**
         * Find values that pass the conditional
         */
        let toExplode = [...this.results].filter(([, { value }]) =>
            _checkCondition(value, conditionals)
        );

        /** Track how many have been inserted */
        let inserted = 0;

        /** Loop through values that need to explode */
        toExplode.forEach(([key, value]) => {
            /** newRoll is the new value to check against the max face value */
            let newRoll = value.value;
            /** i tracks how many times this roll has been exploded */
            let i = 0;

            /**
             * Explode max rolls.
             */
            while (i < times && _checkCondition(newRoll, conditionals)) {
                let previous = this.results.get(key + inserted + i);
                previous.modifiers.add("!");

                newRoll = _getRandomBetween(this.faces.min, this.faces.max);

                /** Insert the new roll into the results map */
                _insertIntoMap(this.results, key + inserted + i + 1, {
                    usable: true,
                    value: newRoll,
                    modifiers: new Set()
                });
                i++;
            }
            /** Update how many have been inserted. */
            inserted += i;
        });
    }
    roll(): number[] {
        if (this.static) {
            return [Number(this.dice)];
        }
        return [...Array(this.rolls)].map(() =>
            _getRandomBetween(this.faces.min, this.faces.max)
        );
    }
}

export class StuntRoll extends DiceRoll {
    constructor(dice: string) {
        super(`3d6`);

        this.dice = dice;
    }
    get doubles() {
        return (
            new Set(
                [...this.results].map(([, { usable, value }]) =>
                    usable ? value : 0
                )
            ).size < 3
        );
    }
    get display() {
        let str: string[] = [];
        for (let result of this.results) {
            if (result[0] == 0 && this.doubles) {
                str.push(`${result[1].value}S`);
                continue;
            }
            str.push(`${result[1].value}`);
        }
        return `[${str.join(", ")}]`;
    }
}

export class TableRoll implements Roller<string> {
    resultArray: string[];
    get result() {
        return this.resultArray.join("|");
    }
    get display() {
        return `${this.result}`;
    }
    constructor(
        public rolls: number,
        public options: string[],
        public text: string,
        public link: string,
        public block: string
    ) {
        this.roll();
    }
    roll() {
        return (this.resultArray = [...Array(this.rolls)].map(
            () => this.options[_getRandomBetween(0, this.options.length - 1)]
        ));
    }
}

export class SectionRoller
    extends Events
    implements Roller<SectionCacheWithFile>
{
    resultArray: SectionCacheWithFile[];
    private selected: Set<SectionCacheWithFile> = new Set();

    constructor(
        public rolls: number = 1,
        public options: SectionCacheWithFile[],
        public content: Map<string, string>,
        public file: string
    ) {
        super();
        if (!rolls) this.rolls = 1;
        this.roll();
    }
    get text() {
        return this.display;
    }

    get result() {
        return this.resultArray[0];
    }
    get display() {
        let res = this.content
            .get(this.file)
            .slice(
                this.result.position.start.offset,
                this.result.position.end.offset
            );

        return `${res}`;
    }
    displayFromCache(cache: SectionCacheWithFile) {
        let res = this.content
            .get(cache.file)
            .slice(cache.position.start.offset, cache.position.end.offset);

        return `${res}`;
    }
    get remaining() {
        return this.options.filter((o) => !this.selected.has(o));
    }

    element(parent: HTMLElement) {
        parent.empty();
        const holder = parent.createDiv();

        for (let result of Array.from(this.selected)) {
            const resultEl = holder.createDiv();
            if (this.content.size > 1) {
                resultEl.createEl("h5", {
                    cls: "dice-file-name",
                    text: result.file
                });
            }
            resultEl.onclick = async (evt) => {
                if (
                    (evt && evt.getModifierState("Control")) ||
                    evt.getModifierState("Meta")
                ) {
                    evt.stopPropagation();
                    this.trigger("open-link", result.file);
                    return;
                }
            };
            const ret = resultEl.createDiv({
                cls: "markdown-embed"
            });
            if (!result) {
                ret.createDiv({
                    cls: "dice-no-results",
                    text: "No results."
                });

                continue;
            }

            const embed = ret.createDiv({
                attr: {
                    "aria-label": `${result.file}: ${result.type}`
                }
            });
            MarkdownRenderer.renderMarkdown(
                this.displayFromCache(result),
                embed,
                "",
                null
            );
        }

        holder.onclick = async (evt) => {
            evt.stopPropagation();

            this.roll();
            this.element(parent);
        };

        return holder;
    }
    roll() {
        this.selected = new Set();
        this.resultArray = [...Array(this.rolls)].map(() => {
            const choice =
                this.remaining[_getRandomBetween(0, this.remaining.length - 1)];
            this.selected.add(choice);
            return choice;
        });
        return this.resultArray;
    }
}

export class FileRoller implements Roller<string> {
    resultArray: string[];
    get result() {
        return this.resultArray[0];
    }

    get text() {
        return "";
    }
    get display() {
        return this.result;
    }
    async element(sourcePath: string = "") {
        const file = await this.cache.getFirstLinkpathDest(
            this.display,
            sourcePath
        );
        /* return  */ const link = createEl("a", {
            cls: "internal-link",
            text: file.basename
        });

        return link;
    }
    roll() {
        return (this.resultArray = [...Array(this.rolls)].map(
            () => this.options[_getRandomBetween(0, this.options.length - 1)]
        ));
    }
    constructor(
        public rolls: number = 1,
        public options: string[],
        private cache: MetadataCache
    ) {
        if (!rolls) this.rolls = 1;
        this.roll();
    }
}