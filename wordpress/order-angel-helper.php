<?php
/**
 * Plugin Name: Order Angel helper
 * Description: Small helper for Order Angel (the Tillotson app). When Order Angel changes the lines on an order
 *              (after the dealer approves an edit), recalculate tax and totals, which the WooCommerce REST API
 *              doesn't do by itself on an update. Does nothing else.
 * Version:     1.0
 *
 * Install: upload this file to wp-content/mu-plugins/ (create the folder if needed). Must-use plugins load
 * automatically and can't be switched off by accident.
 */
if (!defined('ABSPATH')) exit;

add_action('woocommerce_rest_insert_shop_order_object', function ($order, $request, $creating) {
    if ($creating || !$request->get_param('order_angel_recalculate')) return;
    // Line prices are kept as Order Angel sent them; this recalculates tax, then the order total, and saves.
    $order->calculate_totals(true);
}, 10, 3);
