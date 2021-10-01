import { Component, Events } from "obsidian";
import * as THREE from "three";
import * as CANNON from "cannon-es";

import { DiceRoller } from "src/roller";
import {
    D100DiceShape,
    D10DiceShape,
    D12DiceShape,
    D20DiceShape,
    D4DiceShape,
    D6DiceShape,
    D8DiceShape
} from "./renderer/geometries";
import DiceRollerPlugin from "src/main";

export default class DiceRenderer extends Component {
    event = new Events();

    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    world: World;
    camera: THREE.PerspectiveCamera;

    container: HTMLElement = createDiv("renderer-container");

    current: Dice[] = [];
    directionalLight: THREE.DirectionalLight;
    ambientLight: THREE.AmbientLight;

    animation: number;

    light: THREE.SpotLight;
    shadows: boolean = true;
    desk: any;
    iterations: number = 0;

    factory = new DiceFactory(this.WIDTH, this.HEIGHT, this.plugin);
    frame_rate = 1 / 60;

    get WIDTH() {
        return this.container.clientWidth / 2;
    }
    get HEIGHT() {
        return this.container.clientHeight / 2;
    }
    get ASPECT() {
        return this.WIDTH / this.HEIGHT;
    }
    get scale() {
        return (this.WIDTH * this.WIDTH + this.HEIGHT * this.HEIGHT) / 13;
    }
    get canvasEl() {
        if (!this.renderer) return null;
        return this.renderer.domElement;
    }

    animating = false;

    constructor(public plugin: DiceRollerPlugin) {
        super();
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });
        this.addChild(this.factory);
    }

    setDice(dice: DiceRoller[]) {
        if (this.animating) {
            this.unload();
            this.load();
        }
        this.current = this.factory.getDice(dice, {
            x: (Math.random() * 2 - 1) * this.WIDTH,
            y: -(Math.random() * 2 - 1) * this.HEIGHT
        });
        if (!this.current) {
            this.unload();
            return;
        }
        this.scene.add(...this.current.map((d) => d.geometry));
        this.world.add(...this.current);
    }

    onload() {
        this.container.empty();
        this.container.style.opacity = `1`;
        document.body.appendChild(this.container);

        this.renderer.shadowMap.enabled = this.shadows;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);
        this.renderer.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();

        this.initScene();

        this.registerDomEvent(window, "resize", () => {
            this.initScene();
        });

        this.initWorld();
    }

    async start(): Promise<Array<[number, number[]]>> {
        return new Promise(async (resolve) => {
            this.event.on("throw-finished", (result) => {
                resolve(result);
            });
            this.animating = true;
            this.render();
        });
    }

    enableShadows() {
        this.shadows = true;
        if (this.renderer) this.renderer.shadowMap.enabled = this.shadows;
        if (this.light) this.light.castShadow = this.shadows;
        if (this.desk) this.desk.receiveShadow = this.shadows;
    }
    disableShadows() {
        this.shadows = false;
        if (this.renderer) this.renderer.shadowMap.enabled = this.shadows;
        if (this.light) this.light.castShadow = this.shadows;
        if (this.desk) this.desk.receiveShadow = this.shadows;
    }
    colors = {
        ambient: 0xffffff,
        spotlight: 0xffffff
    };

    get mw() {
        return Math.max(this.WIDTH, this.HEIGHT);
    }
    display: { [key: string]: number } = {
        currentWidth: null,
        currentHeight: null,
        containerWidth: null,
        containerHeight: null,
        aspect: null,
        scale: null
    };
    cameraHeight: { [key: string]: number } = {
        max: null,
        close: null,
        medium: null,
        far: null
    };
    setDimensions(dimensions?: { w: number; h: number }) {
        this.display.currentWidth = this.container.clientWidth / 2;
        this.display.currentHeight = this.container.clientHeight / 2;
        if (dimensions) {
            this.display.containerWidth = dimensions.w;
            this.display.containerHeight = dimensions.h;
        } else {
            this.display.containerWidth = this.display.currentWidth;
            this.display.containerHeight = this.display.currentHeight;
        }
        this.display.aspect = Math.min(
            this.display.currentWidth / this.display.containerWidth,
            this.display.currentHeight / this.display.containerHeight
        );
        this.display.scale =
            Math.sqrt(
                this.display.containerWidth * this.display.containerWidth +
                    this.display.containerHeight * this.display.containerHeight
            ) / 13;

        this.renderer.setSize(
            this.display.currentWidth * 2,
            this.display.currentHeight * 2
        );

        this.cameraHeight.max =
            this.display.currentHeight /
            this.display.aspect /
            Math.tan((10 * Math.PI) / 180);

        this.factory.width = this.display.currentWidth;
        this.factory.height = this.display.currentHeight;

        this.cameraHeight.medium = this.cameraHeight.max / 1.5;
        this.cameraHeight.far = this.cameraHeight.max;
        this.cameraHeight.close = this.cameraHeight.max / 2;
    }

    initCamera() {
        if (this.camera) this.scene.remove(this.camera);
        this.camera = new THREE.PerspectiveCamera(
            20,
            this.display.currentWidth / this.display.currentHeight,
            1,
            this.cameraHeight.max * 1.3
        );

        this.camera.position.z = this.cameraHeight.far;

        this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    }
    initLighting() {
        const maxwidth = Math.max(
            this.display.containerWidth,
            this.display.containerHeight
        );

        if (this.light) this.scene.remove(this.light);
        if (this.ambientLight) this.scene.remove(this.ambientLight);
        this.light = new THREE.SpotLight(this.colors.spotlight, 1);
        this.light.position.set(-maxwidth / 2, maxwidth / 2, maxwidth * 3);
        this.light.target.position.set(0, 0, 0);
        this.light.distance = maxwidth * 5;
        this.light.angle = Math.PI / 4;
        this.light.castShadow = this.shadows;
        this.light.shadow.camera.near = maxwidth / 10;
        this.light.shadow.camera.far = maxwidth * 5;
        this.light.shadow.camera.fov = 50;
        this.light.shadow.bias = 0.001;
        this.light.shadow.mapSize.width = 1024;
        this.light.shadow.mapSize.height = 1024;
        this.scene.add(this.light);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        this.scene.add(this.ambientLight);
    }
    initDesk() {
        if (this.desk) this.scene.remove(this.desk);
        let shadowplane = new THREE.ShadowMaterial();
        shadowplane.opacity = 0.5;
        this.desk = new THREE.Mesh(
            new THREE.PlaneGeometry(
                this.display.containerWidth * 6,
                this.display.containerHeight * 6,
                1,
                1
            ),
            shadowplane
        );
        this.desk.receiveShadow = this.shadows;
        this.scene.add(this.desk);
    }
    initScene() {
        this.setDimensions();
        this.initCamera();
        this.initLighting();
        this.initDesk();

        this.camera.updateProjectionMatrix();

        this.renderer.render(this.scene, this.camera);
    }
    initWorld() {
        this.world = new World(this.WIDTH, this.HEIGHT);
        this.iterations = 0;
    }

    render() {
        if (this.throwFinished()) {
            const map: { [key: number]: number[] } = {};

            let percents: D10Dice[] = (this.current.filter(
                (d) => d instanceof D10Dice && d.isPercentile
            ) ?? []) as D10Dice[];
            if (percents.length % 2 != 0) {
                percents[percents.length - 1].isPercentile = false;
                percents.pop();
            }
            for (let i = 0; i < percents.length; i += 2) {
                const percent = percents.slice(i, i + 2);
                let tens = percent[0].getUpsideValue();
                let ones = percent[1].getUpsideValue();

                if (tens === 10 && ones == 10) {
                    map[100] = [...(map[100] ?? []), 100];
                } else {
                    if (ones == 10) ones = 0;
                    if (tens == 10) tens = 0;
                    map[100] = [...(map[100] ?? []), tens * 10 + ones];
                }
                this.dispose(...percent.map((p) => p.geometry));
            }
            this.current = this.current.filter(
                (d) => !(d instanceof D10Dice && d.isPercentile)
            );

            this.current.forEach((dice) => {
                map[dice.sides] = [
                    ...(map[dice.sides] ?? []),
                    dice.getUpsideValue()
                ];
            });
            const sorted = Object.entries(map).sort((a, b) => b[0] - a[0]);
            this.event.trigger("throw-finished", sorted);
            this.registerInterval(
                window.setTimeout(() => {
                    this.container.style.opacity = `0`;
                    this.registerInterval(
                        window.setTimeout(() => {
                            this.animating = false;
                            this.unload();
                        }, 1000)
                    );
                }, 2000)
            );

            return;
        }
        this.animation = requestAnimationFrame(() => this.render());

        this.world.step(this.frame_rate);
        this.iterations++;
        this.current.forEach((dice) => {
            dice.set();
        });

        this.renderer.render(this.scene, this.camera);
    }
    dispose(...children: any[]) {
        children.forEach((child) => {
            if ("dispose" in child) child.dispose();
            if (child.children) this.dispose(...child.children);
        });
    }
    detach() {}
    onunload() {
        cancelAnimationFrame(this.animation);

        this.container.detach();
        this.container.empty();
        this.renderer.domElement.detach();
        this.renderer.dispose();
        this.factory.dispose();

        this.ambientLight.dispose();
        this.light.dispose();

        this.scene.children.forEach((child) => this.dispose(child));

        this.scene.remove(
            this.scene,
            ...this.scene.children,
            ...this.current.map((d) => d.geometry)
        );

        this.current.forEach((dice) => {
            let materials = [
                ...(Array.isArray(dice.geometry.material)
                    ? dice.geometry.material
                    : [dice.geometry.material])
            ];
            materials.forEach((material) => material && material.dispose());
            this.world.world.removeBody(dice.body);
        });
        this.current = [];

        //causes white flash?
        //this.renderer.forceContextLoss();
    }

    onThrowFinished() {}

    throwFinished() {
        let res = true;
        const threshold = 6;
        if (this.iterations < 10 / this.frame_rate) {
            for (let i = 0; i < this.current.length; ++i) {
                const dice = this.current[i];
                if (dice.stopped === true) continue;
                const a = dice.body.angularVelocity,
                    v = dice.body.velocity;

                if (
                    Math.abs(a.x) < threshold &&
                    Math.abs(a.y) < threshold &&
                    Math.abs(a.z) < threshold &&
                    Math.abs(v.x) < threshold &&
                    Math.abs(v.y) < threshold &&
                    Math.abs(v.z) < threshold
                ) {
                    if (dice.stopped) {
                        if (this.iterations - dice.stopped > 3) {
                            dice.stopped = true;
                            continue;
                        }
                    } else {
                        dice.stopped = this.iterations;
                    }
                    res = false;
                } else {
                    dice.stopped = undefined;
                    res = false;
                }
            }
        }
        return res;
    }
}

class World {
    add(...dice: Dice[]) {
        dice.forEach((die) => {
            this.world.addBody(die.body);
        });
    }
    lastCallTime: number;
    step(step: number = 1 / 60) {
        const time = performance.now() / 1000; // seconds
        if (!this.lastCallTime) {
            this.world.step(step);
        } else {
            const dt = time - this.lastCallTime;
            this.world.step(step, dt);
        }
        this.lastCallTime = time;
    }
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, -9.82 * 400) });
    ground = this.getPlane();
    constructor(public WIDTH: number, public HEIGHT: number) {
        this.world.broadphase = new CANNON.NaiveBroadphase();
        this.world.allowSleep = true;
        this.ground.position.set(0, 0, 0);
        this.world.addBody(this.ground);
        this.buildWalls();
    }

    diceMaterial = new CANNON.Material();
    deskMaterial = new CANNON.Material();
    barrierMaterial = new CANNON.Material();

    buildWalls() {
        this.world.addContactMaterial(
            new CANNON.ContactMaterial(this.deskMaterial, this.diceMaterial, {
                friction: 0.01,
                restitution: 0.5
            })
        );
        this.world.addContactMaterial(
            new CANNON.ContactMaterial(
                this.barrierMaterial,
                this.diceMaterial,
                { friction: 0, restitution: 1.0 }
            )
        );
        this.world.addContactMaterial(
            new CANNON.ContactMaterial(this.diceMaterial, this.diceMaterial, {
                friction: 0,
                restitution: 0.5
            })
        );
        this.world.addBody(
            new CANNON.Body({
                allowSleep: false,
                mass: 0,
                shape: new CANNON.Plane(),
                material: this.deskMaterial
            })
        );

        let barrier = new CANNON.Body({
            allowSleep: false,
            mass: 0,
            shape: new CANNON.Plane(),
            material: this.barrierMaterial
        });
        barrier.quaternion.setFromAxisAngle(
            new CANNON.Vec3(1, 0, 0),
            Math.PI / 2
        );
        barrier.position.set(0, this.HEIGHT * 0.93, 0);
        this.world.addBody(barrier);

        barrier = new CANNON.Body({
            allowSleep: false,
            mass: 0,
            shape: new CANNON.Plane(),
            material: this.barrierMaterial
        });
        barrier.quaternion.setFromAxisAngle(
            new CANNON.Vec3(1, 0, 0),
            -Math.PI / 2
        );
        barrier.position.set(0, -this.HEIGHT * 0.93, 0);
        this.world.addBody(barrier);

        barrier = new CANNON.Body({
            allowSleep: false,
            mass: 0,
            shape: new CANNON.Plane(),
            material: this.barrierMaterial
        });
        barrier.quaternion.setFromAxisAngle(
            new CANNON.Vec3(0, 1, 0),
            -Math.PI / 2
        );
        barrier.position.set(this.WIDTH * 0.93, 0, 0);
        this.world.addBody(barrier);

        barrier = new CANNON.Body({
            allowSleep: false,
            mass: 0,
            shape: new CANNON.Plane(),
            material: this.barrierMaterial
        });
        barrier.quaternion.setFromAxisAngle(
            new CANNON.Vec3(0, 1, 0),
            Math.PI / 2
        );
        barrier.position.set(-this.WIDTH * 0.93, 0, 0);
        this.world.addBody(barrier);
    }
    getPlane() {
        return new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: new CANNON.Plane()
        });
    }
}

const DEFAULT_VECTOR = {
    pos: {
        x: 0 + 100 * Math.random(),
        y: 0 + 100 * Math.random(),
        z: 0 + 100
    },
    velocity: {
        x: 500 * Math.random() * 2 - 1,
        y: 500 * Math.random() * 2 - 1,
        z: 0
    },
    angular: {
        x: 100 * Math.random(),
        y: 100 * Math.random(),
        z: 100 * Math.random()
    },
    axis: {
        x: Math.random(),
        y: Math.random(),
        z: Math.random(),
        w: Math.random()
    }
};

interface DiceVector {
    pos: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    angular: { x: number; y: number; z: number };
    axis: { x: number; y: number; z: number; w: number };
}

abstract class Dice {
    scale = 50;
    abstract sides: number;
    abstract inertia: number;
    body: CANNON.Body;
    geometry: THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
    >;

    stopped: boolean | number = false;
    iteration: number = 0;

    vector = { ...DEFAULT_VECTOR };
    constructor(
        public w: number,
        public h: number,
        public data: { geometry: THREE.Mesh; body: CANNON.Body }
    ) {
        this.geometry = data.geometry;
        this.body = data.body;
    }
    generateVector(v: { x: number; y: number }): DiceVector {
        const dist = Math.sqrt(v.x * v.x + v.y * v.y);
        const boost = (Math.random() + 3) * dist;
        const vector = { x: v.x / dist, y: v.y / dist };
        const vec = this.makeRandomVector(vector);
        const pos = {
            x: this.w * (vec.x > 0 ? -1 : 1) * 0.9,
            y: this.h * (vec.y > 0 ? -1 : 1) * 0.9,
            z: Math.random() * 200 + 200
        };
        const projector = Math.abs(vec.x / vec.y);
        if (projector > 1.0) pos.y /= projector;
        else pos.x *= projector;
        const velvec = this.makeRandomVector(vector);
        const velocity = {
            x: velvec.x * boost,
            y: velvec.y * boost,
            z: -10
        };

        const angular = {
            x: -(Math.random() * vec.y * 5 + this.inertia * vec.y),
            y: Math.random() * vec.x * 5 + this.inertia * vec.x,
            z: 0
        };
        const axis = {
            x: Math.random(),
            y: Math.random(),
            z: Math.random(),
            w: Math.random()
        };
        return {
            pos,
            velocity,
            angular,
            axis
        };
    }
    makeRandomVector(vector: { x: number; y: number }) {
        const random_angle = (Math.random() * Math.PI) / 5 - Math.PI / 5 / 2;
        const vec = {
            x:
                vector.x * Math.cos(random_angle) -
                vector.y * Math.sin(random_angle),
            y:
                vector.x * Math.sin(random_angle) +
                vector.y * Math.cos(random_angle)
        };
        if (vec.x == 0) vec.x = 0.01;
        if (vec.y == 0) vec.y = 0.01;
        return vec;
    }
    get buffer() {
        return this.geometry.geometry;
    }
    getUpsideValue() {
        let vector = new THREE.Vector3(0, 0, this.sides == 4 ? -1 : 1);
        let closest_face,
            closest_angle = Math.PI * 2;
        const normals = this.buffer.getAttribute("normal").array;
        for (let i = 0, l = this.buffer.groups.length; i < l; ++i) {
            const face = this.buffer.groups[i];
            if (face.materialIndex == 0) continue;
            let startVertex = i * 9;
            const normal = new THREE.Vector3(
                normals[startVertex],
                normals[startVertex + 1],
                normals[startVertex + 2]
            );
            const angle = normal
                .clone()
                .applyQuaternion(
                    new THREE.Quaternion(
                        this.body.quaternion.x,
                        this.body.quaternion.y,
                        this.body.quaternion.z,
                        this.body.quaternion.w
                    )
                )
                .angleTo(vector);
            if (angle < closest_angle) {
                closest_angle = angle;
                closest_face = face;
            }
        }
        let matindex = closest_face.materialIndex - 1;
        if (this.sides == 10 && matindex == 0) matindex = 10;
        return matindex;
    }

    shiftUpperValue(to: number) {
        let geometry = this.geometry.geometry.clone();

        let from = this.getUpsideValue();
        for (let i = 0, l = geometry.groups.length; i < l; ++i) {
            let materialIndex = geometry.groups[i].materialIndex;
            if (materialIndex === 0) continue;

            materialIndex += to - from - 1;
            while (materialIndex > this.sides) materialIndex -= this.sides;
            while (materialIndex < 1) materialIndex += this.sides;

            geometry.groups[i].materialIndex = materialIndex + 1;
        }

        this.updateMaterialsForValue(to - from);

        this.geometry.geometry = geometry;
    }

    resetBody() {
        this.body.vlambda = new CANNON.Vec3();
        //this..body.collisionResponse = true;
        this.body.position = new CANNON.Vec3();
        this.body.previousPosition = new CANNON.Vec3();
        this.body.initPosition = new CANNON.Vec3();
        this.body.velocity = new CANNON.Vec3();
        this.body.initVelocity = new CANNON.Vec3();
        this.body.force = new CANNON.Vec3();
        //this.body.sleepState = 0;
        //this.body.timeLastSleepy = 0;
        //this.body._wakeUpAfterNarrowphase = false;
        this.body.torque = new CANNON.Vec3();
        this.body.quaternion = new CANNON.Quaternion();
        this.body.initQuaternion = new CANNON.Quaternion();
        this.body.angularVelocity = new CANNON.Vec3();
        this.body.initAngularVelocity = new CANNON.Vec3();
        this.body.interpolatedPosition = new CANNON.Vec3();
        this.body.interpolatedQuaternion = new CANNON.Quaternion();
        this.body.inertia = new CANNON.Vec3();
        this.body.invInertia = new CANNON.Vec3();
        this.body.invInertiaWorld = new CANNON.Mat3();
        //this.body.invMassSolve = 0;
        this.body.invInertiaSolve = new CANNON.Vec3();
        this.body.invInertiaWorldSolve = new CANNON.Mat3();
        //this.body.aabb = new CANNON.AABB();
        //this.body.aabbNeedsUpdate = true;
        this.body.wlambda = new CANNON.Vec3();

        this.body.updateMassProperties();
    }
    updateMaterialsForValue(value: number) {}
    set() {
        this.geometry.position.set(
            this.body.position.x,
            this.body.position.y,
            this.body.position.z
        );
        this.geometry.quaternion.set(
            this.body.quaternion.x,
            this.body.quaternion.y,
            this.body.quaternion.z,
            this.body.quaternion.w
        );
    }
    create() {
        this.body.position.set(
            this.vector.pos.x,
            this.vector.pos.y,
            this.vector.pos.z
        );
        this.body.quaternion.setFromAxisAngle(
            new CANNON.Vec3(
                this.vector.axis.x,
                this.vector.axis.y,
                this.vector.axis.z
            ),
            this.vector.axis.w * Math.PI * 2
        );
        this.body.angularVelocity.set(
            this.vector.angular.x,
            this.vector.angular.y,
            this.vector.angular.z
        );
        this.body.velocity.set(
            this.vector.velocity.x,
            this.vector.velocity.y,
            this.vector.velocity.z
        );
        this.body.linearDamping = 0.1;
        this.body.angularDamping = 0.1;
    }
}

class DiceFactory extends Component {
    get colors() {
        return {
            diceColor: this.plugin.data.diceColor,
            textColor: this.plugin.data.textColor
        };
    }
    d100 = new D100DiceShape(this.width, this.height, this.colors);
    d20 = new D20DiceShape(this.width, this.height, this.colors);
    d12 = new D12DiceShape(this.width, this.height, this.colors);
    d10 = new D10DiceShape(this.width, this.height, this.colors);
    d8 = new D8DiceShape(this.width, this.height, this.colors);
    d6 = new D6DiceShape(this.width, this.height, this.colors);
    d4 = new D4DiceShape(this.width, this.height, this.colors);
    constructor(
        public width: number,
        public height: number,
        public plugin: DiceRollerPlugin
    ) {
        super();
    }
    updateColors() {
        this.dispose();
        this.d100 = new D100DiceShape(this.width, this.height, this.colors);
        this.d20 = new D20DiceShape(this.width, this.height, this.colors);
        this.d12 = new D12DiceShape(this.width, this.height, this.colors);
        this.d10 = new D10DiceShape(this.width, this.height, this.colors);
        this.d8 = new D8DiceShape(this.width, this.height, this.colors);
        this.d6 = new D6DiceShape(this.width, this.height, this.colors);
        this.d4 = new D4DiceShape(this.width, this.height, this.colors);
    }
    onunload() {
        this.dispose();
    }
    disposeChildren(...children: any[]) {
        children.forEach((child) => {
            if ("dispose" in child) child.dispose();
            if (child.children) this.disposeChildren(...child.children);
        });
    }
    dispose() {
        this.disposeChildren(this.d100.geometry.children);
        this.disposeChildren(this.d20.geometry.children);
        this.disposeChildren(this.d12.geometry.children);
        this.disposeChildren(this.d10.geometry.children);
        this.disposeChildren(this.d8.geometry.children);
        this.disposeChildren(this.d6.geometry.children);
        this.disposeChildren(this.d4.geometry.children);
    }
    getDice(rollers: DiceRoller[], vector?: { x: number; y: number }) {
        const dice: Dice[] = [];
        for (const roller of rollers) {
            switch (roller.faces.max) {
                case 4: {
                    dice.push(
                        ...new Array(roller.rolls)
                            .fill(0)
                            .map(
                                (r) =>
                                    new D4Dice(
                                        this.width,
                                        this.height,
                                        this.d4.clone(),
                                        vector
                                    )
                            )
                    );
                    break;
                }
                case 6: {
                    dice.push(
                        ...new Array(roller.rolls)
                            .fill(0)
                            .map(
                                (r) =>
                                    new D6Dice(
                                        this.width,
                                        this.height,
                                        this.d6.clone(),
                                        vector
                                    )
                            )
                    );
                    break;
                }
                case 8: {
                    dice.push(
                        ...new Array(roller.rolls)
                            .fill(0)
                            .map(
                                (r) =>
                                    new D8Dice(
                                        this.width,
                                        this.height,
                                        this.d8.clone(),
                                        vector
                                    )
                            )
                    );
                    break;
                }
                case 10: {
                    dice.push(
                        ...new Array(roller.rolls)
                            .fill(0)
                            .map(
                                (r) =>
                                    new D10Dice(
                                        this.width,
                                        this.height,
                                        this.d10.clone(),
                                        vector
                                    )
                            )
                    );
                    break;
                }
                case 12: {
                    dice.push(
                        ...new Array(roller.rolls)
                            .fill(0)
                            .map(
                                (r) =>
                                    new D12Dice(
                                        this.width,
                                        this.height,
                                        this.d12.clone(),
                                        vector
                                    )
                            )
                    );
                    break;
                }
                case 20:
                default: {
                    dice.push(
                        ...new Array(roller.rolls)
                            .fill(0)
                            .map(
                                (r) =>
                                    new D20Dice(
                                        this.width,
                                        this.height,
                                        this.d20.clone(),
                                        vector
                                    )
                            )
                    );
                    break;
                }
                case 100: {
                    dice.push(
                        ...new Array(roller.rolls)
                            .fill(0)
                            .map((r) => [
                                new D10Dice(
                                    this.width,
                                    this.height,
                                    this.d100.clone(),
                                    vector,
                                    true
                                ),
                                new D10Dice(
                                    this.width,
                                    this.height,
                                    this.d10.clone(),
                                    vector,
                                    true
                                )
                            ])
                            .flat()
                    );
                    break;
                }
            }
        }
        return dice;
    }
}

class D20Dice extends Dice {
    sides = 20;
    inertia = 6;
    constructor(
        public w: number,
        public h: number,
        public data: { geometry: THREE.Mesh; body: CANNON.Body },
        vector?: { x: number; y: number }
    ) {
        super(w, h, data);
        if (vector) {
            this.vector = this.generateVector(vector);
        }
        this.create();
    }
}

class D12Dice extends Dice {
    sides = 12;
    inertia = 8;
    constructor(
        public w: number,
        public h: number,
        public data: { geometry: THREE.Mesh; body: CANNON.Body },
        vector?: { x: number; y: number }
    ) {
        super(w, h, data);
        if (vector) {
            this.vector = this.generateVector(vector);
        }
        this.create();
    }
}

class D10Dice extends Dice {
    sides = 10;
    inertia = 9;
    constructor(
        public w: number,
        public h: number,
        public data: { geometry: THREE.Mesh; body: CANNON.Body },
        vector?: { x: number; y: number },
        public isPercentile: boolean = false
    ) {
        super(w, h, data);
        if (vector) {
            this.vector = this.generateVector(vector);
        }
        this.create();
    }
}

class D8Dice extends Dice {
    sides = 8;
    inertia = 10;
    constructor(
        public w: number,
        public h: number,
        public data: { geometry: THREE.Mesh; body: CANNON.Body },
        vector?: { x: number; y: number }
    ) {
        super(w, h, data);
        if (vector) {
            this.vector = this.generateVector(vector);
        }
        this.create();
    }
}

class D6Dice extends Dice {
    sides = 6;
    inertia = 13;
    constructor(
        public w: number,
        public h: number,
        public data: { geometry: THREE.Mesh; body: CANNON.Body },
        vector?: { x: number; y: number }
    ) {
        super(w, h, data);
        if (vector) {
            this.vector = this.generateVector(vector);
        }
        this.create();
    }
}
class D4Dice extends Dice {
    sides = 4;
    inertia = 5;
    constructor(
        public w: number,
        public h: number,
        public data: { geometry: THREE.Mesh; body: CANNON.Body },
        vector?: { x: number; y: number }
    ) {
        super(w, h, data);
        if (vector) {
            this.vector = this.generateVector(vector);
        }
        this.create();
    }
}