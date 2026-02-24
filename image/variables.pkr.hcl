variable "hcloud_token" {
  type      = string
  sensitive = true
  default   = env("HCLOUD_TOKEN")
}

variable "build_version" {
  type    = string
  default = "dev"
}

variable "go_version" {
  type    = string
  default = "1.23.6"
}
