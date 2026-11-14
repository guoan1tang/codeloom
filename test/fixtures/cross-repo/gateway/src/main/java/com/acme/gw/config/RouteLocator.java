package com.acme.gw.config;

import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;

public class GatewayRouteConfig {
    @Bean
    public RouteLocator orderRoute(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("order-route", r -> r.path("/api-order/**").filters(f -> f.stripPrefix(1)).uri("lb://order-service"))
            .build();
    }
}
