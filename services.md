---
layout: default
title: Services
---

<div class="page-content">
  <div class="container">
    <h1>{{ page.title }}</h1>
    
    <div class="services-list">
      {% for service in site.data.services %}
      <div class="service-item">
        <h3>{{ service.name }}</h3>
        <p class="service-description">{{ service.description }}</p>
        <div class="service-details">
          <span class="service-price">{{ service.price }}</span>
          <span class="service-duration">{{ service.duration }}</span>
        </div>
      </div>
      {% endfor %}
    </div>
    
    <div class="booking-cta">
      <h3>Ready to book?</h3>
      <a href="#booking" class="btn btn-primary">Book Your Appointment</a>
    </div>
  </div>
</div>
