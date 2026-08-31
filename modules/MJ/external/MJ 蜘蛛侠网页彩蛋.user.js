// ==UserScript==
// @name         MJ 蜘蛛侠网页彩蛋
// @namespace    https://tampermonkey.net/
// @version      1.0.3
// @description  在输入框输入 mj 后自动触发蜘蛛侠特效
// @match        *://*/*
// @grant        none
// @run-at       document-end
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/593142/MJ%20%E8%9C%98%E8%9B%9B%E4%BE%A0%E7%BD%91%E9%A1%B5%E5%BD%A9%E8%9B%8B.user.js
// @updateURL https://update.greasyfork.org/scripts/593142/MJ%20%E8%9C%98%E8%9B%9B%E4%BE%A0%E7%BD%91%E9%A1%B5%E5%BD%A9%E8%9B%8B.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 蜘蛛侠图片
    // ============================================================

    const SPIDER_IMAGE =
        'https://i.ibb.co/rfT3PdHG/QQ-20260827144316.gif';


    // ============================================================
    // 基本参数
    // ============================================================

    const CONFIG = {

        // 蜘蛛侠大小
        width: 200,
        height: 200,

        // 距离网页顶部
        top: 20,

        // 动画时间
        duration: 4500,

        // 触发冷却时间
        cooldown: 3000
    };


    // 上一次触发时间
    let lastTriggerTime = 0;


    // 当前输入框上一次的值
    const inputValues = new WeakMap();


    // ============================================================
    // 判断是否为可输入元素
    // ============================================================

    function isEditable(element) {

        if (!element) {
            return false;
        }


        // textarea
        if (element.tagName === 'TEXTAREA') {
            return true;
        }


        // input
        if (element.tagName === 'INPUT') {

            const type = (
                element.getAttribute('type') || 'text'
            ).toLowerCase();


            const disabledTypes = [
                'button',
                'submit',
                'reset',
                'checkbox',
                'radio',
                'file',
                'range',
                'color',
                'hidden'
            ];


            return !disabledTypes.includes(type);
        }


        // contenteditable
        if (element.isContentEditable) {
            return true;
        }


        return false;
    }


    // ============================================================
    // 获取输入框内容
    // ============================================================

    function getInputValue(element) {

        if (element.isContentEditable) {

            return (
                element.innerText ||
                element.textContent ||
                ''
            );
        }


        return element.value || '';
    }


    // ============================================================
    // 创建蜘蛛侠
    // ============================================================

    function showSpiderMan() {

        const now = Date.now();


        // 冷却时间内不重复触发
        if (
            now - lastTriggerTime <
            CONFIG.cooldown
        ) {
            return;
        }


        lastTriggerTime = now;


        // 删除之前的蜘蛛侠
        const oldSpider =
            document.querySelector(
                '.tm-mj-spiderman'
            );


        if (oldSpider) {
            oldSpider.remove();
        }


        // ========================================================
        // 创建容器
        // ========================================================

        const container =
            document.createElement('div');


        container.className =
            'tm-mj-spiderman';


        // ========================================================
        // 创建图片
        // ========================================================

        const image =
            document.createElement('img');


        image.className =
            'tm-mj-spiderman-image';


        image.src =
            SPIDER_IMAGE;


        image.alt =
            '';


        image.draggable =
            false;


        // ========================================================
        // 添加
        // ========================================================

        container.appendChild(image);

        document.body.appendChild(container);


        // ========================================================
        // 动画结束后删除
        // ========================================================

        setTimeout(function () {

            if (container) {
                container.remove();
            }

        }, CONFIG.duration + 300);
    }


    // ============================================================
    // ★★★ 监听输入 ★★★
    //
    // 不再监听 Enter
    //
    // 用户输入：
    //
    // m
    // ↓
    // mj
    // ↓
    // 立即触发
    //
    // 不需要按回车
    // ============================================================

    document.addEventListener(
        'input',
        function (event) {

            const input =
                event.target;


            // 必须是输入框
            if (!isEditable(input)) {
                return;
            }


            const value =
                getInputValue(input)
                    .trim();


            const lowerValue =
                value.toLowerCase();


            // ========================================================
            // 防止同一个值重复触发
            // ========================================================

            const previousValue =
                inputValues.get(input) || '';


            inputValues.set(
                input,
                value
            );


            // ========================================================
            // 必须是从：
            //
            // m
            // ↓
            // mj
            //
            // 这样变化才触发
            // ========================================================

            if (
                lowerValue !== 'mj'
            ) {
                return;
            }


            // 如果之前已经就是 mj
            // 不重复触发
            if (
                previousValue.toLowerCase() ===
                'mj'
            ) {
                return;
            }


            // ========================================================
            // 立即触发蜘蛛侠
            // ========================================================

            showSpiderMan();

        },
        true
    );


    // ============================================================
    // CSS
    // ============================================================

    const style =
        document.createElement('style');


    style.textContent = `

        /*
         * ========================================================
         * 蜘蛛侠外层
         * ========================================================
         */

        .tm-mj-spiderman {

            position: fixed;

            top: ${CONFIG.top}px;

            left: 50%;

            width: ${CONFIG.width}px;

            height: ${CONFIG.height}px;

            z-index: 2147483647;

            pointer-events: none;

            user-select: none;

            -webkit-user-select: none;

            transform-origin: 50% 0%;

            animation:

                tm-mj-main

                ${CONFIG.duration}ms

                cubic-bezier(
                    0.22,
                    0.61,
                    0.36,
                    1
                )

                forwards;
        }


        /*
         * ========================================================
         * 蜘蛛侠图片
         * ========================================================
         */

        .tm-mj-spiderman-image {

            display: block;

            width: 100%;

            height: 100%;

            object-fit: contain;

            border: 0;

            padding: 0;

            margin: 0;

            outline: none;

            user-select: none;

            -webkit-user-select: none;

            -webkit-user-drag: none;

            animation:

                tm-mj-character

                ${CONFIG.duration}ms

                ease-in-out

                forwards;
        }


        /*
         * ========================================================
         * 主动画
         *
         * 出现
         * ↓
         * 停留
         * ↓
         * 慢慢消失
         * ========================================================
         */

        @keyframes tm-mj-main {

            0% {

                opacity: 0;

                transform:
                    translateX(-50%)
                    translateY(-35px)
                    scale(0.92)
                    rotate(-4deg);
            }


            10% {

                opacity: 1;

                transform:
                    translateX(-50%)
                    translateY(0)
                    scale(1)
                    rotate(2deg);
            }


            20% {

                opacity: 1;

                transform:
                    translateX(-50%)
                    translateY(0)
                    scale(1)
                    rotate(-2deg);
            }


            40% {

                opacity: 1;

                transform:
                    translateX(-50%)
                    translateY(0)
                    scale(1)
                    rotate(2deg);
            }


            58% {

                opacity: 0.95;

                transform:
                    translateX(-50%)
                    translateY(0)
                    scale(1)
                    rotate(-1deg);
            }


            75% {

                opacity: 0.55;

                transform:
                    translateX(-50%)
                    translateY(-3px)
                    scale(0.98)
                    rotate(1deg);
            }


            90% {

                opacity: 0.18;

                transform:
                    translateX(-50%)
                    translateY(-5px)
                    scale(0.96)
                    rotate(0deg);
            }


            100% {

                opacity: 0;

                transform:
                    translateX(-50%)
                    translateY(-5px)
                    scale(0.94)
                    rotate(0deg);
            }
        }


        /*
         * ========================================================
         * 蜘蛛侠轻微摆动
         * ========================================================
         */

        @keyframes tm-mj-character {

            0% {
                transform: rotate(-3deg);
            }

            18% {
                transform: rotate(3deg);
            }

            35% {
                transform: rotate(-2deg);
            }

            52% {
                transform: rotate(2deg);
            }

            68% {
                transform: rotate(-1deg);
            }

            82% {
                transform: rotate(1deg);
            }

            100% {
                transform: rotate(0deg);
            }
        }

    `;


    // ============================================================
    // 注入 CSS
    // ============================================================

    document.head.appendChild(style);


})();