package com.acme.shop.order;

import com.acme.shop.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders")
public class OrderController {
    @Autowired
    private OrderService orderService;

    @PostMapping(value = "/create")
    public String create(@RequestBody String body) {
        return orderService.createOrder(body);
    }

    @GetMapping(path = "/{id}")
    public String get(@PathVariable String id) {
        return orderService.findById(id);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable String id) {
        orderService.cancel(id);
    }

    @RequestMapping(value = "/search", method = RequestMethod.GET)
    public String search(@RequestParam String keyword) {
        return orderService.search(keyword);
    }
}
